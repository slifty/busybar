// What the command line can say, which is deliberately very little.
//
// Settings live in the config file. The two things here are the ones that
// cannot: which file to read, and a program to run on its own for one run
// without editing anything -- `npm run dev -- focus`. Anything else worth
// setting is worth writing down somewhere it can carry a comment explaining
// itself.

import { parseArgs } from "node:util";

const CONFIG_OPTION = "config";
const HELP_OPTION = "help";
const HELP_SHORT = "h";

interface Invocation {
	readonly help: boolean;
	// The file to read settings from, or undefined for the default.
	readonly configPath: string | undefined;
	// Programs named on the command line, which run instead of the ones the
	// config file lists. Empty when none were named.
	readonly programNames: string[];
}

const usage = (programNames: string[], configFile: string): string =>
	[
		"usage: busybar [program...] [--config <file>]",
		"",
		`Runs the programs the \`run\` list in ${configFile} names. Naming`,
		"programs here runs those instead, on whatever the file has configured",
		"for them.",
		"",
		`  --${CONFIG_OPTION} <file>  read settings from <file> instead`,
		`  --${HELP_OPTION}, -${HELP_SHORT}       show this`,
		"",
		`programs: ${programNames.join(", ")}`,
		"",
	].join("\n");

// Everything the command line asked for, or a reason it asked for nothing
// runnable.
//
// `parseArgs` refuses an unknown option on its own, which is the behaviour
// worth having -- a mistyped flag that was quietly ignored would leave the
// tool doing something other than what it was told, and looking like it had
// obeyed. Its message says what it did not recognise; the usage line is added
// because the message alone does not say what it would have taken.
const parseCommandLine = (args: string[]): Invocation => {
	try {
		const { values, positionals } = parseArgs({
			args,
			options: {
				[CONFIG_OPTION]: { type: "string" },
				[HELP_OPTION]: { type: "boolean", short: HELP_SHORT },
			},
			allowPositionals: true,
		});

		return {
			help: values[HELP_OPTION] ?? false,
			configPath: values[CONFIG_OPTION],
			programNames: positionals,
		};
	} catch (error) {
		// What went wrong is left to the cause rather than repeated here, since
		// the tool prints an error with its causes appended and saying it twice
		// is how a one-line complaint becomes a paragraph.
		throw new Error(`could not read the command line -- try --${HELP_OPTION}`, {
			cause: error,
		});
	}
};

export { parseCommandLine, usage };
export type { Invocation };
