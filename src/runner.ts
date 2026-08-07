import { once } from "node:events";
import { clearApplication, isPreempted } from "./display.ts";
import type { BusyBar } from "@busy-app/busy-lib";
import type { Program } from "./program.ts";

// Node exits as soon as nothing is scheduled, and a registered signal handler
// does not count as scheduled work. A program with a refresh interval is held
// open by its own timer; one that draws once needs this instead. The length is
// irrelevant -- only the timer's existence matters.
const KEEP_ALIVE_INTERVAL_MS = 60_000;

// Runs a program until SIGINT or SIGTERM, then clears whatever it drew.
//
// Everything that is the same for every program lives here: the first draw,
// the optional refresh schedule, tolerating preemption, and cleanup on the way
// out.
const runProgram = async (
	bar: BusyBar,
	program: Program,
	log: (message: string) => void,
): Promise<void> => {
	const context = { bar, applicationName: program.name };

	const draw = async (): Promise<void> => {
		try {
			await program.draw(context);
		} catch (error) {
			// A focus session outranks us, and transient request failures
			// happen even over USB. Neither is worth exiting over.
			if (isPreempted(error)) {
				log("a higher-priority app owns the screen");
			} else {
				log(
					`draw failed: ${error instanceof Error ? error.message : String(error)}`,
				);
			}
		}
	};

	await draw();

	const { refreshIntervalMs } = program;
	const timer =
		refreshIntervalMs === undefined
			? setInterval(() => {
					// Nothing to do; this only holds the event loop open.
				}, KEEP_ALIVE_INTERVAL_MS)
			: setInterval(() => {
					void draw();
				}, refreshIntervalMs);

	const controller = new AbortController();
	const stop = (): void => {
		controller.abort();
	};

	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	await once(controller.signal, "abort");
	clearInterval(timer);

	// Elements drawn without a timeout would otherwise stay up after we exit.
	await clearApplication(bar, program.name);
};

export { runProgram };
