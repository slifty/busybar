import { helloWorld } from "./hello-world/index.ts";
import { randomEmoji } from "./random-emoji/index.ts";
import type { Program } from "../program.ts";

// Every operating mode the tool knows how to run, keyed by the name you put in
// BUSYBAR_PROGRAM. Adding a program means adding a folder beside this file and
// one entry here.
const PROGRAMS = {
	[helloWorld.name]: helloWorld,
	[randomEmoji.name]: randomEmoji,
} as const satisfies Record<string, Program>;

const { name: DEFAULT_PROGRAM_NAME } = helloWorld;

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

export { DEFAULT_PROGRAM_NAME, programNames, resolveProgram };
