import { once } from "node:events";
import { clearApplication, isPreempted } from "./display.ts";
import type { BusyBar } from "@busy-app/busy-lib";
import type { Program } from "./program.ts";

// Node exits as soon as nothing is scheduled, and a registered signal handler
// does not count as scheduled work. A program waiting on its next draw is held
// open by that timer, but one that has asked never to be drawn again is not.
// The length is irrelevant -- only the timer's existence matters.
const KEEP_ALIVE_INTERVAL_MS = 60_000;

// How long to wait before drawing again after a draw fails.
//
// A failure is not the program's decision, so it does not get to schedule
// around it: whatever it asked for described a successful draw. Coming back on
// a short fixed delay means a program preempted by a focus session takes the
// screen back shortly after that session ends, rather than staying dark.
const RETRY_DELAY_MS = 5_000;

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

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
		log(`failed to clear the display: ${describe(error)}`);
	}
};

// Runs a program until SIGINT or SIGTERM, then clears whatever it drew.
//
// Everything that is the same for every program lives here: drawing, honouring
// the program's request for when to draw next, tolerating preemption, and
// cleanup on the way out.
const runProgram = async (
	bar: BusyBar,
	program: Program,
	log: (message: string) => void,
): Promise<void> => {
	const context = { bar, applicationName: program.name };
	const controller = new AbortController();

	// Losing the screen to a focus session is expected and can persist for the
	// length of that session. Reporting the transitions keeps a program that
	// retries every few seconds from filling the log with the same line.
	let preempted = false;
	let nextDraw: NodeJS.Timeout | undefined = undefined;

	// Draws once, reporting how long to wait before drawing again -- or
	// undefined if the program asked not to be drawn again.
	const drawOnce = async (): Promise<number | undefined> => {
		try {
			const { nextDrawInMs } = await program.draw(context);

			if (preempted) {
				preempted = false;
				log("regained the screen");
			}

			return nextDrawInMs;
		} catch (error) {
			// A focus session outranks us, and transient request failures
			// happen even over USB. Neither is worth exiting over.
			if (isPreempted(error)) {
				if (!preempted) {
					preempted = true;
					log("a higher-priority app owns the screen; still trying");
				}
			} else {
				log(`draw failed: ${describe(error)}`);
			}

			return RETRY_DELAY_MS;
		}
	};

	const drawAndSchedule = async (): Promise<void> => {
		const delayMs = await drawOnce();

		// A program that wants no further draws leaves nothing scheduled, and
		// there is no point scheduling a draw we are already shutting down on.
		if (delayMs === undefined || controller.signal.aborted) {
			return;
		}

		nextDraw = setTimeout(() => {
			void drawAndSchedule();
		}, delayMs);
	};

	const keepAlive = setInterval(() => {
		// Nothing to do; this only holds the event loop open.
	}, KEEP_ALIVE_INTERVAL_MS);

	const stop = (): void => {
		controller.abort();
	};

	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	try {
		await drawAndSchedule();
		await once(controller.signal, "abort");
	} finally {
		clearInterval(keepAlive);
		clearTimeout(nextDraw);
		await cleanUp(bar, program.name, log);
	}
};

export { runProgram };
