import { readFile } from "node:fs/promises";
import type { Focus } from "./focus.ts";

// Where the blocks are read from. A calendar will replace this; until then a
// file keeps the rest of the program honest, because it has to cope with
// whatever is written in it.
// `local/` is git-ignored wholesale: it is where anything personal to one
// machine lives, which a schedule of what someone is doing all day plainly is.
// A calendar will want a credential and a cache in there beside this.
const FOCUS_FILE_ENV_VAR = "BUSYBAR_FOCUS_FILE";
const DEFAULT_FOCUS_FILE = "local/focus.json";

// Text elements only accept printable ASCII, because the fonts are bitmap
// ASCII. Calendar titles will not respect that -- en dashes, curly quotes and
// emoji are all ordinary in a title -- so anything undrawable is dropped and
// the surrounding whitespace tidied, rather than letting the device reject the
// draw over a character nobody would miss.
const UNDRAWABLE = /[^\x20-\x7E]+/gv;
const RUN_OF_SPACES = / {2,}/gv;

const drawableName = (name: string): string =>
	name.replace(UNDRAWABLE, " ").replace(RUN_OF_SPACES, " ").trim();

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

// Reads the focus blocks, failing loudly on anything it cannot make sense of.
//
// A schedule that is missing or malformed is a mistake worth stopping for: the
// alternative is a bar that sits dark all day while the reason scrolls past in
// a log.
const readSchedule = async (path: string): Promise<string> => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		throw new Error(
			`could not read ${path} -- set ${FOCUS_FILE_ENV_VAR} to point at a focus schedule`,
			{ cause: error },
		);
	}
};

const parseSchedule = (contents: string, path: string): unknown => {
	try {
		return JSON.parse(contents);
	} catch (error) {
		throw new Error(`${path} is not valid JSON`, { cause: error });
	}
};

const loadBlocks = async (): Promise<Focus[]> => {
	const path = process.env[FOCUS_FILE_ENV_VAR] ?? DEFAULT_FOCUS_FILE;
	const parsed = parseSchedule(await readSchedule(path), path);

	if (!Array.isArray(parsed)) {
		throw new Error(`${path} must hold an array of focus blocks`);
	}

	return parsed.map((block: unknown, index) => parseBlock(block, index, path));
};

export { DEFAULT_FOCUS_FILE, FOCUS_FILE_ENV_VAR, drawableName, loadBlocks };
