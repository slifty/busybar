// Entry point for the BUSY Bar tool.
//
// The bar runs the programs the config file lists -- one operating mode, like
// a scrolling greeting, or several at once -- or the ones named on the command
// line instead. This reads the settings, resolves the programs, connects to
// the device, and hands over to the runner.

import { BusyBar } from "@busy-app/busy-lib";
import { parseCommandLine, usage } from "./cli.ts";
import { DEFAULT_CONFIG_FILE, loadConfig } from "./config/index.ts";
import { describe } from "./errors.ts";
import { programNames, resolvePrograms } from "./programs/index.ts";
import { runPrograms } from "./runner.ts";

// The length of a list with nothing in it.
const NOTHING = 0;

// `process.argv` starts with the runtime and the script, and what somebody
// typed comes after them.
const ARGUMENTS_START = 2;

const log = (message: string): void => {
	process.stdout.write(`busybar: ${message}\n`);
};

const main = async (): Promise<void> => {
	const invocation = parseCommandLine(process.argv.slice(ARGUMENTS_START));

	if (invocation.help) {
		process.stdout.write(usage(programNames(), DEFAULT_CONFIG_FILE));

		return;
	}

	const config = await loadConfig(invocation.configPath);

	// Worth saying, because a bar running the default program and a bar
	// reading a file that is not where it was thought to be look the same from
	// across the room -- and the second is the more likely of the two to be
	// what happened, the moment there is a file at all.
	if (!config.found) {
		log(`no ${config.path} -- every setting is at its default`);
	}

	// Naming programs on the command line replaces the list rather than adding
	// to it: the point of `npm run dev -- focus` is to see one program on its
	// own, which it would not be if the file's programs kept drawing over it.
	// Their configured blocks still apply.
	const requested =
		invocation.programNames.length > NOTHING
			? invocation.programNames
			: config.programNames;

	const programs = resolvePrograms(requested);

	const bar = new BusyBar({ addr: config.deviceAddress });

	// Fail loudly and immediately if the bar is not reachable, rather than
	// leaving the process running with nothing on screen.
	const { name } = await bar.SettingsNameGet();

	log(`connected to "${name}" at ${config.deviceAddress}`);

	// Said before any of them is prepared, so it describes what is being
	// attempted rather than what is working. A program that cannot start says
	// so itself a moment later, under its own name, and the ones that can carry
	// on without it -- so a line claiming all of them were running would be
	// wrong about exactly the case worth reading a log for.
	for (const program of programs) {
		log(`starting "${program.name}" -- ${program.description}`);
	}

	await runPrograms(bar, programs, config, log);
};

try {
	await main();
} catch (error) {
	process.stderr.write(`busybar: ${describe(error)}\n`);
	process.exitCode = 1;
}
