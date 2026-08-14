import { rename, writeFile } from "node:fs/promises";
import { readCalendarSource, readLocalFile } from "../../calendar/source.ts";
import { drawableName } from "../../text.ts";
import { parseCalendar } from "./calendar.ts";
import { CALENDAR_KEY, FILE_KEY } from "./settings.ts";
import type { Focus } from "./focus.ts";
import type { FocusSettings } from "./settings.ts";

// Where the blocks come from.
//
// Two sources, and the program above this cannot tell which it got. A calendar
// is the real one; the JSON file predates it and stays because a schedule you
// can type in a text editor is the fastest way to try something without
// exporting anything. Which of them is in use is `programs.focus.calendar`,
// and both are read through `settings.ts`.
//
// Reading a source -- fetching a URL, opening a path -- is shared with every
// other program that reads a calendar and lives in `src/calendar/source.ts`.
// What is here is the JSON file, which is this program's alone.

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

const parseJson = (contents: string, path: string): unknown => {
	try {
		return JSON.parse(contents);
	} catch (error) {
		throw new Error(`${path} is not valid JSON`, { cause: error });
	}
};

const loadJsonBlocks = async (settings: FocusSettings): Promise<Focus[]> => {
	const { file: path, where } = settings;
	const parsed = parseJson(
		await readLocalFile(path, where(FILE_KEY), "a focus schedule"),
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
// taking the calendar back out of the config file.
const loadBlocks = async (settings: FocusSettings): Promise<Focus[]> => {
	const { calendar } = settings;

	if (calendar === undefined) {
		return await loadJsonBlocks(settings);
	}

	return parseCalendar(
		await readCalendarSource(calendar, settings.where(CALENDAR_KEY)),
		new Date(),
		calendar,
	);
};

// Written with tabs to match everything else here, and with the trailing
// newline a text editor would leave.
const INDENT = "\t";

const asJson = (blocks: readonly Focus[]): string =>
	`${JSON.stringify(
		blocks.map(({ name, start, end }) => ({
			name,
			start: start.toISOString(),
			end: end.toISOString(),
		})),
		undefined,
		INDENT,
	)}\n`;

// Writes what a calendar said into the JSON file, replacing whatever was there.
//
// This is not a cache: the calendar is read afresh on every draw and nothing
// falls back to the file while one is set. It is there to be looked at. A
// schedule you cannot see is a schedule you cannot debug, and a stale file left
// beside a live calendar is worse than no file at all -- it reads as the
// answer to "what is the bar showing?" while being nothing of the kind.
//
// What lands is what the bar will draw rather than what the calendar holds:
// names sanitised to what the fonts can render, all-day and cancelled events
// already dropped, and only the blocks near enough to now to matter. Unsetting
// the calendar afterwards therefore leaves a working schedule behind.
//
// Failing is reported and no more. The tool reads the calendar directly and
// works perfectly without ever writing this, so a read-only directory is not a
// reason to refuse to run -- but it is a reason to say so, since the file's
// whole purpose is to be trusted when you look at it.
const mirrorBlocks = async (
	{ calendar, file: path }: FocusSettings,
	blocks: readonly Focus[],
	log: (message: string) => void,
): Promise<void> => {
	if (calendar === undefined) {
		return;
	}

	try {
		// Written beside the file and moved over it, so that a process which
		// dies mid-write cannot leave invalid JSON where a schedule should be.
		const temporary = `${path}.writing`;

		await writeFile(temporary, asJson(blocks), "utf8");
		await rename(temporary, path);
	} catch (error) {
		const reason = error instanceof Error ? error.message : String(error);

		log(`could not write the schedule to ${path}: ${reason}`);
	}
};

export { loadBlocks, mirrorBlocks };
