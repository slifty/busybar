import { readFile } from "node:fs/promises";
import { MS_PER_SECOND } from "../../constants/time.ts";
import { parseCalendar } from "./calendar.ts";
import { drawableName } from "./name.ts";
import type { Focus } from "./focus.ts";

// Where the blocks come from.
//
// Two sources, and the program above this cannot tell which it got. A calendar
// is the real one; the JSON file predates it and stays because a schedule you
// can type in a text editor is the fastest way to try something without
// exporting anything.
//
// `local/` is git-ignored wholesale: it is where anything personal to one
// machine lives, which a schedule of what someone is doing all day plainly is.
// A calendar URL kept in `.env` and a cache belong in there beside it.
const FOCUS_CALENDAR_ENV_VAR = "BUSYBAR_FOCUS_CALENDAR";
const FOCUS_FILE_ENV_VAR = "BUSYBAR_FOCUS_FILE";
const DEFAULT_FOCUS_FILE = "local/focus.json";

// How long to wait for a calendar served over HTTP.
//
// Short, because this is on the path of every draw. A feed that has not
// answered in ten seconds has already cost more than the draw was worth, and
// the runner will come back in five.
const FETCH_TIMEOUT_SECONDS = 10;
const FETCH_TIMEOUT_MS = FETCH_TIMEOUT_SECONDS * MS_PER_SECOND;

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (
	block: Record<string, unknown>,
	key: string,
	describe: (problem: string) => Error,
): string => {
	const { [key]: value } = block;

	if (typeof value !== "string") {
		throw describe(`"${key}" must be a string`);
	}

	return value;
};

const readDate = (
	block: Record<string, unknown>,
	key: string,
	describe: (problem: string) => Error,
): Date => {
	const value = readString(block, key, describe);
	const date = new Date(value);

	if (Number.isNaN(date.getTime())) {
		throw describe(`"${key}" is not a date: ${value}`);
	}

	return date;
};

const parseBlock = (value: unknown, index: number, path: string): Focus => {
	const describe = (problem: string): Error =>
		new Error(`${path}: block ${String(index)}: ${problem}`);

	if (!isRecord(value)) {
		throw describe("expected an object");
	}

	const name = drawableName(readString(value, "name", describe));

	if (name === "") {
		throw describe('"name" has nothing the display can render');
	}

	const start = readDate(value, "start", describe);
	const end = readDate(value, "end", describe);

	if (end.getTime() <= start.getTime()) {
		throw describe('"end" must be after "start"');
	}

	return { name, start, end };
};

// Reads a source from disk, failing loudly rather than quietly.
//
// A source that is missing is a mistake worth stopping for: the alternative is
// a bar that sits dark all day while the reason scrolls past in a log. Saying
// which variable to set is most of what makes that message useful.
//
// `what` names the kind of thing that was expected, because a calendar and a
// schedule file are read the same way but configured separately -- a message
// that called both "a focus schedule" would describe the wrong file half the
// time it appeared.
const readLocalFile = async (
	path: string,
	variable: string,
	what: string,
): Promise<string> => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		throw new Error(
			`could not read ${path} -- set ${variable} to point at ${what}`,
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

const readCalendar = async (source: string): Promise<string> =>
	isFetchable(source)
		? await fetchCalendar(source)
		: await readLocalFile(source, FOCUS_CALENDAR_ENV_VAR, "an iCalendar feed");

const parseJson = (contents: string, path: string): unknown => {
	try {
		return JSON.parse(contents);
	} catch (error) {
		throw new Error(`${path} is not valid JSON`, { cause: error });
	}
};

const loadJsonBlocks = async (): Promise<Focus[]> => {
	const path = process.env[FOCUS_FILE_ENV_VAR] ?? DEFAULT_FOCUS_FILE;
	const parsed = parseJson(
		await readLocalFile(path, FOCUS_FILE_ENV_VAR, "a focus schedule"),
		path,
	);

	if (!Array.isArray(parsed)) {
		throw new Error(`${path} must hold an array of focus blocks`);
	}

	return parsed.map((block: unknown, index) => parseBlock(block, index, path));
};

// Reads the focus blocks from whichever source is configured.
//
// A calendar wins when one is named, because naming it is the deliberate act;
// the JSON file is what you get by default and what you fall back to by
// unsetting the calendar.
const loadBlocks = async (): Promise<Focus[]> => {
	// An unset variable and one set to nothing mean the same thing here: no
	// calendar was named, so the file is what is left.
	const source = process.env[FOCUS_CALENDAR_ENV_VAR] ?? "";

	if (source === "") {
		return await loadJsonBlocks();
	}

	return parseCalendar(await readCalendar(source), new Date(), source);
};

export {
	DEFAULT_FOCUS_FILE,
	FOCUS_CALENDAR_ENV_VAR,
	FOCUS_FILE_ENV_VAR,
	drawableName,
	isFetchable,
	loadBlocks,
};
