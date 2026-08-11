// Everything the tool was told to do, read from one file.
//
// The file is YAML in `local/`, which is git-ignored wholesale -- a schedule
// of what somebody is doing all day, and the secret calendar address it comes
// from, are personal to one machine. It is the only place settings come from:
// there is no environment variable, no second file, and nothing a program
// reads on its own account, so "what is this bar set up to do?" is answered by
// opening one file rather than by knowing where else to look.
//
// It is read once, at startup. A program re-reads the things it works from --
// `focus` reads its schedule on every draw, because somebody else is writing
// it -- but the configuration is this tool's own, and a setting that changed
// under a running process would leave the log describing a run that is no
// longer happening. Restart to change it.

import { readFile } from "node:fs/promises";
import { parse } from "yaml";
import { DEFAULT_DEVICE_ADDRESS } from "../constants/device.ts";
import { createSection } from "./section.ts";
import type { ConfigSection } from "./section.ts";

// Where settings live unless `--config` says otherwise.
const DEFAULT_CONFIG_FILE = "local/config.yml";

// The top-level block holding one block per program to run.
const PROGRAMS_KEY = "programs";

// The block of settings about the bar itself.
const DEVICE_KEY = "device";
const ADDRESS_KEY = "address";

// The path from the top of the file, for the root block. It has none.
const ROOT_PATH = "";

interface Config {
	// The file this came from, and whether it was there. Running with no file
	// at all is ordinary -- every setting has a default -- but it is worth
	// saying out loud, since a bar doing the default thing and a bar reading a
	// file it cannot find look identical from across the room.
	readonly path: string;
	readonly found: boolean;
	readonly deviceAddress: string;
	// The programs the file asks to run, in the order they were written.
	readonly programNames: string[];
	// One program's block. A program with no block reads as one with nothing
	// set, so naming a program on the command line without configuring it runs
	// it on its defaults.
	readonly forProgram: (name: string) => ConfigSection;
}

// Whether a file was not there, as opposed to being there and unreadable.
//
// A missing file is the ordinary case for the default path and a mistake for
// one somebody typed, and the two have to be told apart. Node reports it as a
// `code` on an otherwise plain Error, so it is read off an `unknown` by duck
// typing.
const isMissing = (error: unknown): boolean =>
	error instanceof Error && "code" in error && error.code === "ENOENT";

// Reads the file, or reports that there was none.
//
// A file that was asked for by name has to be there: `--config` is a
// deliberate act, and silently running the defaults instead would answer a
// question nobody asked. The default path is the opposite -- not having one is
// how the tool is meant to work out of the box.
const readConfigFile = async (
	path: string,
	required: boolean,
): Promise<string | undefined> => {
	try {
		return await readFile(path, "utf8");
	} catch (error) {
		if (isMissing(error) && !required) {
			return undefined;
		}

		throw new Error(`could not read ${path}`, { cause: error });
	}
};

const parseYaml = (contents: string, path: string): unknown => {
	try {
		return parse(contents);
	} catch (error) {
		// The parser's own message says which line and why, which is most of
		// what is worth knowing, so it is kept as the cause rather than
		// summarised away.
		throw new Error(`${path} is not valid YAML`, { cause: error });
	}
};

// Reads the config file, or hands back what the tool does with no file at all.
//
// Everything the file says is checked here rather than when it is first
// wanted: an address that is not text, or a top-level key nobody recognises,
// is a mistake in the file and stops the tool before it draws anything. What
// is left for later is each program's own block, which only that program knows
// the settings of -- the runner has it validated once the program has read it.
const loadConfig = async (path?: string): Promise<Config> => {
	const file = path ?? DEFAULT_CONFIG_FILE;
	const contents = await readConfigFile(file, path !== undefined);
	const root = createSection(
		file,
		ROOT_PATH,
		contents === undefined ? undefined : parseYaml(contents, file),
	);

	const device = root.section(DEVICE_KEY);
	const deviceAddress = device.string(ADDRESS_KEY, DEFAULT_DEVICE_ADDRESS);

	device.done();

	const programs = root.section(PROGRAMS_KEY);
	const programNames = programs.names();

	root.done();

	return {
		path: file,
		found: contents !== undefined,
		deviceAddress,
		programNames,
		forProgram: (name) => programs.section(name),
	};
};

export { DEFAULT_CONFIG_FILE, loadConfig };
export type { Config };
