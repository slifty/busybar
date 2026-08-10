// Entry point for the BUSY Bar tool.
//
// The bar runs one program at a time -- an operating mode, like a scrolling
// greeting. This picks the program named by BUSYBAR_PROGRAM, connects to the
// device, and hands over to the runner.

import { BusyBar } from "@busy-app/busy-lib";
import { DEVICE_ADDRESS, PROGRAM_ENV_VAR } from "./config.ts";
import {
	DEFAULT_PROGRAM_NAME,
	programNames,
	resolveProgram,
} from "./programs/index.ts";
import { runProgram } from "./runner.ts";

const log = (message: string): void => {
	process.stdout.write(`busybar: ${message}\n`);
};

// Errors are reported with their causes appended, because the message that
// explains what went wrong is usually the innermost one: "could not read
// focus.json" is only useful next to the ENOENT that prompted it.
const describe = (error: unknown): string => {
	if (!(error instanceof Error)) {
		return String(error);
	}

	return error.cause === undefined
		? error.message
		: `${error.message}: ${describe(error.cause)}`;
};

const main = async (): Promise<void> => {
	const requested = process.env[PROGRAM_ENV_VAR] ?? DEFAULT_PROGRAM_NAME;
	const program = resolveProgram(requested);

	if (program === undefined) {
		throw new Error(
			`unknown program "${requested}". ` +
				`Set ${PROGRAM_ENV_VAR} to one of: ${programNames().join(", ")}`,
		);
	}

	const bar = new BusyBar({ addr: DEVICE_ADDRESS });

	// Fail loudly and immediately if the bar is not reachable, rather than
	// leaving the process running with nothing on screen.
	const { name } = await bar.SettingsNameGet();

	log(`connected to "${name}" at ${DEVICE_ADDRESS}`);
	log(`running "${program.name}" -- ${program.description}`);

	await runProgram(bar, program, log);
};

try {
	await main();
} catch (error) {
	process.stderr.write(`busybar: ${describe(error)}\n`);
	process.exitCode = 1;
}
