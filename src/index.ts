// Entry point for the BUSY Bar tool.
//
// The bar runs the programs named by BUSYBAR_PROGRAM -- one operating mode,
// like a scrolling greeting, or several at once. This resolves them, connects
// to the device, and hands over to the runner.

import { BusyBar } from "@busy-app/busy-lib";
import { PROGRAM_ENV_VAR } from "./config.ts";
import { DEVICE_ADDRESS } from "./constants/device.ts";
import { describe } from "./errors.ts";
import { resolvePrograms } from "./programs/index.ts";
import { runPrograms } from "./runner.ts";

const log = (message: string): void => {
	process.stdout.write(`busybar: ${message}\n`);
};

const main = async (): Promise<void> => {
	const programs = resolvePrograms(process.env[PROGRAM_ENV_VAR]);

	const bar = new BusyBar({ addr: DEVICE_ADDRESS });

	// Fail loudly and immediately if the bar is not reachable, rather than
	// leaving the process running with nothing on screen.
	const { name } = await bar.SettingsNameGet();

	log(`connected to "${name}" at ${DEVICE_ADDRESS}`);

	// Said before any of them is prepared, so it describes what is being
	// attempted rather than what is working. A program that cannot start says
	// so itself a moment later, under its own name, and the ones that can carry
	// on without it -- so a line claiming all of them were running would be
	// wrong about exactly the case worth reading a log for.
	for (const program of programs) {
		log(`starting "${program.name}" -- ${program.description}`);
	}

	await runPrograms(bar, programs, log);
};

try {
	await main();
} catch (error) {
	process.stderr.write(`busybar: ${describe(error)}\n`);
	process.exitCode = 1;
}
