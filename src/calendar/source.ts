import { readFile } from "node:fs/promises";
import { MS_PER_SECOND } from "../constants/time.ts";

// Where a configured source is read from: a URL to fetch, or a path to open.
//
// Kept apart from what is done with the text, because every program that reads
// a calendar reads it the same way and none of them should have to import
// another program to do it.

// How long to wait for a calendar served over HTTP.
//
// Short, because this is on the path of every draw. A feed that has not
// answered in ten seconds has already cost more than the draw was worth, and
// the runner will come back in five.
const FETCH_TIMEOUT_SECONDS = 10;
const FETCH_TIMEOUT_MS = FETCH_TIMEOUT_SECONDS * MS_PER_SECOND;

// How long to wait before asking a failing calendar again, in seconds.
//
// Doubling, to a ceiling of two minutes. A feed that went wrong once is
// usually a feed that will be fine in a moment -- Google's iCalendar export
// answers 500 to a request it served happily a minute earlier -- so the first
// wait is short enough to make the failure invisible. The ones after it grow
// because a server that is still failing after a minute is having a worse day
// than that, and asking it every fifteen seconds is neither kind nor useful.
//
// The list also decides how many attempts there are: five, spread over just
// under four minutes. That fits inside the `event` refresh interval, which
// matters because the next read is scheduled once this one has finished --
// retries push the following cycle back rather than racing it.
const FIRST_RETRY_SECONDS = 15;
const LAST_RETRY_SECONDS = 120;
const RETRY_GROWTH = 2;

const retryDelaysMs = (): readonly number[] => {
	const delays: number[] = [];

	for (
		let seconds = FIRST_RETRY_SECONDS;
		seconds <= LAST_RETRY_SECONDS;
		seconds *= RETRY_GROWTH
	) {
		delays.push(seconds * MS_PER_SECOND);
	}

	return delays;
};

const RETRY_DELAYS_MS = retryDelaysMs();

// The lowest status that means the server rather than the request went wrong.
const FIRST_SERVER_ERROR_STATUS = 500;

// Reads a source from disk, failing loudly rather than quietly.
//
// A source that is missing is a mistake worth stopping for: the alternative is
// a bar that sits dark all day while the reason scrolls past in a log. Saying
// which setting to fix, and in which file, is most of what makes that message
// useful.
//
// `what` names the kind of thing that was expected, because a calendar and a
// schedule file are read the same way but configured separately -- a message
// that called both "a focus schedule" would describe the wrong file half the
// time it appeared.
const readLocalFile = async (
	path: string,
	setting: string,
	what: string,
): Promise<string> => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		throw new Error(
			`could not read ${path} -- set ${setting} to point at ${what}`,
			{ cause: error },
		);
	}
};

// Whether a source names something to fetch rather than something to open.
//
// A path and a URL are told apart by the URL parsing, not by looking for a
// slash or a dot: `local/focus.ics` is not a URL, `https://…/basic.ics` is, and
// anything else -- a `file:` URL, a Windows drive letter -- is treated as a
// path and left to the filesystem to accept or reject.
const isFetchable = (source: string): boolean => {
	if (!URL.canParse(source)) {
		return false;
	}

	const { protocol } = new URL(source);

	return protocol === "http:" || protocol === "https:";
};

// Waiting between attempts, without that wait being a reason to stay running.
//
// Unrefd for the same reason `refresh.ts` unrefs its interval: reading a
// calendar is not what the process is for. Without it, a tool asked to stop
// part-way through a backoff would sit out the rest of the wait -- up to two
// minutes of it -- before it could exit.
//
// The global timer rather than `node:timers/promises`, which would say this
// more directly and cannot be faked: the suites drive these waits through
// `vi.useFakeTimers`, which reaches the global and not the module.
const wait = async (ms: number): Promise<void> => {
	// eslint-disable-next-line promise/avoid-new -- a timer is the one thing there is no promise to build this out of
	await new Promise<void>((resolve) => {
		setTimeout(resolve, ms).unref();
	});
};

// What one request came back with: the calendar, or a reason and whether
// asking again could plausibly help.
//
// A network failure and a calendar that answers badly stay distinguishable,
// because the first cannot say more than that it did not arrive and the second
// can say what came back instead. They differ in the other direction too: a
// 4xx is a wrong address or a key that has been rotated and will say the same
// thing however many times it is asked, so retrying it only delays the message
// that would have somebody go and fix it.
type Attempt =
	| { readonly ok: true; readonly text: string }
	| { readonly ok: false; readonly error: Error; readonly again: boolean };

// Asks once, handing back whatever came of it -- an answer, or the reason
// there was not one.
const requestCalendar = async (url: string): Promise<Response | Error> => {
	try {
		return await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		return new Error(`could not fetch the calendar at ${url}`, {
			cause: error,
		});
	}
};

const attemptCalendar = async (url: string): Promise<Attempt> => {
	const response = await requestCalendar(url);

	if (response instanceof Error) {
		// Nothing arrived at all -- a timeout, a refused connection, a name
		// that did not resolve. Every one of those is worth another go.
		return { ok: false, again: true, error: response };
	}

	if (!response.ok) {
		return {
			ok: false,
			again: response.status >= FIRST_SERVER_ERROR_STATUS,
			error: new Error(
				`the calendar at ${url} answered ${String(response.status)} ${response.statusText}`,
			),
		};
	}

	return { ok: true, text: await response.text() };
};

// Fetches a calendar, giving a server that went wrong the chance to come back.
//
// The last failure is the one thrown. An earlier attempt's message would
// describe a moment that has since passed, and the caller is about to put this
// on the bar.
const fetchCalendar = async (
	url: string,
	remaining: readonly number[] = RETRY_DELAYS_MS,
): Promise<string> => {
	const attempt = await attemptCalendar(url);

	if (attempt.ok) {
		return attempt.text;
	}

	const [delayMs, ...rest] = remaining;

	if (!attempt.again || delayMs === undefined) {
		throw attempt.error;
	}

	await wait(delayMs);

	return await fetchCalendar(url, rest);
};

// Reads whichever kind of source was configured.
//
// `setting` is where the value was written, so that a path which cannot be
// opened names the line to go and fix rather than only the file it failed on.
const readCalendarSource = async (
	source: string,
	setting: string,
): Promise<string> =>
	isFetchable(source)
		? await fetchCalendar(source)
		: await readLocalFile(source, setting, "an iCalendar feed");

export { RETRY_DELAYS_MS, isFetchable, readCalendarSource, readLocalFile };
