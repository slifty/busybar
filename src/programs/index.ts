import { PROGRAM_ENV_VAR, PROGRAM_SEPARATOR } from "../config.ts";
import { focus } from "./focus/index.ts";
import { helloWorld } from "./hello-world/index.ts";
import { randomEmoji } from "./random-emoji/index.ts";
import type { Program } from "../program.ts";

// Every operating mode the tool knows how to run, keyed by the name you put in
// BUSYBAR_PROGRAM. Adding a program means adding a folder beside this file and
// one entry here.
const PROGRAMS = {
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

// The names in a BUSYBAR_PROGRAM value, in the order they were written.
//
// Blank is not a request for nothing -- a variable left empty in a `.env` is
// far more often a line someone meant to fill in -- so it falls back to the
// default like an unset one. Whitespace around a name is dropped, because
// `focus, event` is what a list looks like when it is written by hand.
const requestedNames = (requested: string | undefined): string[] => {
	const names = (requested ?? "")
		.split(PROGRAM_SEPARATOR)
		.map((name) => name.trim())
		.filter((name) => name.length > NOTHING);

	return names.length > NOTHING ? names : [DEFAULT_PROGRAM_NAME];
};

// The programs a BUSYBAR_PROGRAM value asks for, or a reason it asks for
// nothing runnable.
//
// Every name is checked before any of them runs. Starting the two programs a
// list got right and then failing on the third would leave the bar half doing
// what was asked for, which is worse than not starting: the display looks
// deliberate either way.
const resolvePrograms = (requested: string | undefined): Program[] => {
	const names = requestedNames(requested);

	// The same program twice is not two programs. It would be one application
	// name drawn to and cleared by two loops, each undoing the other, so the
	// bar would flicker between them and neither would be wrong to blame.
	const duplicate = names.find((name, index) => names.indexOf(name) !== index);

	if (duplicate !== undefined) {
		throw new Error(
			`${PROGRAM_ENV_VAR} asks for "${duplicate}" more than once`,
		);
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
				`Set ${PROGRAM_ENV_VAR} to one or more of: ${programNames().join(", ")}`,
		);
	}

	return resolved
		.map(({ program }) => program)
		.filter((program) => program !== undefined);
};

export { DEFAULT_PROGRAM_NAME, programNames, resolvePrograms };
