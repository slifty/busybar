import { event } from "./event/index.ts";
import { focus } from "./focus/index.ts";
import { helloWorld } from "./hello-world/index.ts";
import { randomEmoji } from "./random-emoji/index.ts";
import { unconfigured } from "./unconfigured/index.ts";
import type { Program } from "../program.ts";

// Every operating mode the tool knows how to run, keyed by the name you write
// in the config file. Adding a program means adding a folder beside this file
// and one entry here.
const PROGRAMS = {
	[event.name]: event,
	[focus.name]: focus,
	[helloWorld.name]: helloWorld,
	[randomEmoji.name]: randomEmoji,
} as const satisfies Record<string, Program>;

// The length of an empty string, and of a list with nothing in it.
const NOTHING = 0;

const programNames = (): string[] => Object.keys(PROGRAMS).sort();

const resolveProgram = (name: string): Program | undefined => {
	// Guarded so that inherited keys like "toString" cannot resolve to
	// something that is not a program.
	if (!Object.hasOwn(PROGRAMS, name)) {
		return undefined;
	}

	const { [name]: program } = PROGRAMS as Record<string, Program>;

	return program;
};

// Refuses any name that is not a program, saying which ones are.
//
// The names come from three places and every one of them is somebody typing:
// the `run` list, the blocks of settings beside it, and the command line. A
// block is checked as well as a run list because a program is configured
// whether or not it is running, so nothing would ever open `focos:` -- and
// settings nothing reads are settings that say plainly what the bar should do
// while doing nothing at all.
//
// The answer to a name nobody recognises is almost always another name, so the
// list of them is what the complaint carries.
const rejectUnknownNames = (names: string[]): void => {
	const unknown = names
		.filter((name) => resolveProgram(name) === undefined)
		.map((name) => `"${name}"`);

	if (unknown.length > NOTHING) {
		throw new Error(
			`unknown program ${unknown.join(", ")}. ` +
				`The programs are: ${programNames().join(", ")}`,
		);
	}
};

// What to run, given what was asked for and the file that was asked in.
//
// Nothing asked for is not a request for nothing: a config file with no `run`
// list in it, or with an empty one, is far more often a file somebody has yet
// to fill in than a deliberate request for a bar that sits there doing
// nothing. So the bar says so, naming the file to go and edit -- which is also
// what a machine with no config file at all gets, and is the whole of what
// this needs the file's name for.
//
// The names it does get are checked before any of them runs. Starting the two
// programs a list got right and then failing on the third would leave the bar
// half doing what was asked for, which is worse than not starting: the display
// looks deliberate either way.
const programsToRun = (names: string[], configFile: string): Program[] => {
	if (names.length === NOTHING) {
		return [unconfigured(configFile)];
	}

	// The same program twice is not two programs. It would be one application
	// name drawn to and cleared by two loops, each undoing the other, so the
	// bar would flicker between them and neither would be wrong to blame.
	//
	// Both lists that reach this can repeat a name: `run` is a YAML list
	// rather than a block of keys, and the command line is whatever was typed.
	const duplicate = names.find((name, index) => names.indexOf(name) !== index);

	if (duplicate !== undefined) {
		throw new Error(`"${duplicate}" is asked for more than once`);
	}

	rejectUnknownNames(names);

	return names
		.map((name) => resolveProgram(name))
		.filter((program) => program !== undefined);
};

export { programNames, programsToRun, rejectUnknownNames };
