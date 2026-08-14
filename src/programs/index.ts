import { event } from "./event/index.ts";
import { focus } from "./focus/index.ts";
import { helloWorld } from "./hello-world/index.ts";
import { randomEmoji } from "./random-emoji/index.ts";
import type { Program } from "../program.ts";

// Every operating mode the tool knows how to run, keyed by the name you write
// under `programs` in the config file. Adding a program means adding a folder
// beside this file and one entry here.
const PROGRAMS = {
	[event.name]: event,
	[focus.name]: focus,
	[helloWorld.name]: helloWorld,
	[randomEmoji.name]: randomEmoji,
} as const satisfies Record<string, Program>;

const { name: DEFAULT_PROGRAM_NAME } = helloWorld;

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

// The names to run, given what was asked for.
//
// Nothing asked for is not a request for nothing: a config file with no
// `programs` block in it, or with an empty one, is far more often a file
// somebody has yet to fill in than a deliberate request for a bar that sits
// there doing nothing. It falls back to the default, which is also what a
// machine with no config file at all gets.
const requestedNames = (requested: string[]): string[] =>
	requested.length > NOTHING ? requested : [DEFAULT_PROGRAM_NAME];

// The programs a list of names asks for, or a reason it asks for nothing
// runnable. The names come from the config file, or from the command line when
// that named any.
//
// Every name is checked before any of them runs. Starting the two programs a
// list got right and then failing on the third would leave the bar half doing
// what was asked for, which is worse than not starting: the display looks
// deliberate either way.
const resolvePrograms = (requested: string[]): Program[] => {
	const names = requestedNames(requested);

	// The same program twice is not two programs. It would be one application
	// name drawn to and cleared by two loops, each undoing the other, so the
	// bar would flicker between them and neither would be wrong to blame.
	//
	// The config file cannot say it twice -- a repeated key is a YAML error,
	// reported with the line it is on -- so what this catches is a list typed
	// on the command line.
	const duplicate = names.find((name, index) => names.indexOf(name) !== index);

	if (duplicate !== undefined) {
		throw new Error(`"${duplicate}" is asked for more than once`);
	}

	const resolved = names.map((name) => ({
		name,
		program: resolveProgram(name),
	}));
	const unknown = resolved
		.filter(({ program }) => program === undefined)
		.map(({ name }) => `"${name}"`);

	if (unknown.length > NOTHING) {
		throw new Error(
			`unknown program ${unknown.join(", ")}. ` +
				`The programs are: ${programNames().join(", ")}`,
		);
	}

	return resolved
		.map(({ program }) => program)
		.filter((program) => program !== undefined);
};

export { DEFAULT_PROGRAM_NAME, programNames, resolvePrograms };
