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

// Separate from the response handling below so that a network failure and a
// calendar that answers badly stay distinguishable: the first cannot say more
// than that it did not arrive, the second can say what came back instead.
const requestCalendar = async (url: string): Promise<Response> => {
	try {
		return await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
	} catch (error) {
		throw new Error(`could not fetch the calendar at ${url}`, { cause: error });
	}
};

const fetchCalendar = async (url: string): Promise<string> => {
	const response = await requestCalendar(url);

	if (!response.ok) {
		throw new Error(
			`the calendar at ${url} answered ${String(response.status)} ${response.statusText}`,
		);
	}

	return await response.text();
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

export { isFetchable, readCalendarSource, readLocalFile };
