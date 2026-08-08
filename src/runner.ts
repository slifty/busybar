import { once } from "node:events";
import { clearApplication, isPreempted } from "./display.ts";
import type { BusyBar } from "@busy-app/busy-lib";
import type { Program } from "./program.ts";

// Node exits as soon as nothing is scheduled, and a registered signal handler
// does not count as scheduled work. A program with a refresh interval is held
// open by its own timer; one that draws once needs this instead. The length is
// irrelevant -- only the timer's existence matters.
const KEEP_ALIVE_INTERVAL_MS = 60_000;

// Clears whatever the program drew.
//
// This has to happen however the program ends, not just on a clean stop.
// Elements drawn with `timeout: 0` never expire on their own, and an
// application holding the screen blocks every other application from drawing
// to it -- so a program that dies without clearing locks the display until
// something else clears it by hand.
//
// Failing to clean up must not replace whatever error we are already unwinding
// from, so this reports rather than throws.
const cleanUp = async (
	bar: BusyBar,
	applicationName: string,
	log: (message: string) => void,
): Promise<void> => {
	try {
		await clearApplication(bar, applicationName);
		log("display cleared");
	} catch (error) {
		log(
			`failed to clear the display: ${error instanceof Error ? error.message : String(error)}`,
		);
	}
};

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

	try {
		await draw();
		await once(controller.signal, "abort");
	} finally {
		clearInterval(timer);
		await cleanUp(bar, program.name, log);
	}
};

export { runProgram };
