import { once } from "node:events";
import { clearApplication, isPreempted, showError } from "./display.ts";
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

// `setTimeout` keeps its delay in a signed 32-bit millisecond count, and
// anything larger wraps round and fires immediately instead. A program working
// from a schedule can easily ask for longer than the twenty-five days that
// leaves -- the next focus block might be next month -- so a long wait is
// taken in hops, redrawing and asking again on each one.
const MAX_DELAY_MS = 2_147_483_647;

// A delay of zero is a program asking to be drawn again immediately, which is
// allowed; a negative one is not a request at all.
const MIN_DELAY_MS = 0;

// What the runner will actually wait, given what a program asked for.
//
// The delay is the one number a program hands back, so it is the one place a
// program's arithmetic can reach the runner. `setTimeout` reads NaN and
// Infinity as zero and a negative delay as zero, so a program that subtracts
// two dates the wrong way round would be redrawn as fast as the event loop
// allows rather than failing visibly. A value that is not a finite number of
// milliseconds is treated as a mistake and retried on the runner's own delay.
const delayFor = (requested: number): number =>
	Number.isFinite(requested)
		? Math.min(Math.max(requested, MIN_DELAY_MS), MAX_DELAY_MS)
		: RETRY_DELAY_MS;

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

// Clears this program's elements, tolerating failure.
//
// Elements outlive the process that drew them: they are drawn with `timeout:
// 0`, so they never expire on their own, and an application holding the screen
// blocks every other application from drawing to it. Everything that clears
// goes through here -- starting from a blank screen, taking a failure down
// before retrying, and cleaning up on the way out are the same request for the
// same reason.
//
// Failing to clear must not replace whatever error is already being unwound
// from, so this reports rather than throws -- and says whether it worked, so
// that nothing downstream claims a screen was cleared when it was not.
const clearDrawing = async (
	bar: BusyBar,
	applicationName: string,
	log: (message: string) => void,
): Promise<boolean> => {
	try {
		await clearApplication(bar, applicationName);

		return true;
	} catch (error) {
		log(`failed to clear the display: ${describe(error)}`);

		return false;
	}
};

// Clears whatever the program drew, however the program ended.
//
// A drawing left behind outlives the process and blocks other applications
// from the screen, so "display cleared" is only worth saying when it is true --
// the failure above it is the part that matters, and following it with a claim
// of success would bury exactly the thing worth acting on.
const cleanUp = async (
	bar: BusyBar,
	applicationName: string,
	log: (message: string) => void,
): Promise<void> => {
	if (await clearDrawing(bar, applicationName, log)) {
		log("display cleared");
	}
};

// Reporting a failure must not become a second failure.
//
// The device being unreachable is one of the things this is here to report, so
// it is also one of the ways drawing the report can itself fail. Either way
// the terminal already has the original error; this only ever adds to it.
const showFailure = async (
	bar: BusyBar,
	applicationName: string,
	log: (message: string) => void,
): Promise<void> => {
	try {
		await showError(bar, applicationName);
	} catch (error) {
		log(`failed to show the failure on the display: ${describe(error)}`);
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

	// Before anything is scheduled or drawn, so that a program which cannot
	// prepare stops the tool with its reason instead of being retried. Nothing
	// is running to stop until this has come back, which is why the program
	// only invites Ctrl-C afterwards.
	//
	// The failure is left on the bar on the way out, and deliberately not
	// cleaned up: the process is about to exit, and a tool that never started
	// is precisely the case where the screen must not look ordinary. Clearing
	// it is then the next run's job, or `DisplayClear`'s.
	try {
		await program.start?.(context);
	} catch (error) {
		await showFailure(bar, program.name, log);

		throw error;
	}

	// Nothing this run drew is on screen yet, so anything that is belongs to a
	// run that is over -- most likely a failure the last one left up on its way
	// out, which is exactly what it was left there for. Having been seen, it
	// goes, rather than sitting underneath everything this run draws over it.
	await clearDrawing(bar, program.name, log);

	log("press Ctrl-C to stop");

	const controller = new AbortController();

	// Losing the screen to a focus session is expected and can persist for the
	// length of that session. Reporting the transitions keeps a program that
	// retries every few seconds from filling the log with the same line.
	let preempted = false;

	// Whether a failure is currently on screen. Read before an await and
	// written after one, which `require-atomic-updates` flags -- rightly in
	// general, though not here: draws never overlap, because each one schedules
	// the next only once it has finished.
	let failing = false;

	let nextDraw: NodeJS.Timeout | undefined = undefined;

	// Draws once, reporting how long to wait before drawing again -- or
	// undefined if the program asked not to be drawn again.
	const drawOnce = async (): Promise<number | undefined> => {
		// The failure comes down before the attempt rather than after it
		// succeeds. The device gives a tie on priority to whichever
		// application already owns the screen, and the error is drawn under
		// the program's own name, so an error left up is an error the program
		// cannot draw over -- the report of the failure would be the thing
		// preventing the recovery.
		if (failing) {
			await clearDrawing(bar, program.name, log);
		}

		try {
			const { nextDrawInMs } = await program.draw(context);

			if (preempted) {
				preempted = false;
				log("regained the screen");
			}

			// A draw that works is the only thing that ends a run of failures,
			// so an error is on screen for exactly as long as the tool is
			// actually broken.
			if (failing) {
				failing = false;
				log("recovered");
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

				// Put back after every failed attempt, not only the first,
				// because each attempt takes it down again on the way in.
				// eslint-disable-next-line require-atomic-updates -- draws never overlap, so there is no interleaved update to lose
				failing = true;
				await showFailure(bar, program.name, log);
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

		if (!Number.isFinite(delayMs)) {
			log(`ignoring an impossible next-draw delay of ${String(delayMs)}`);
		}

		nextDraw = setTimeout(() => {
			void drawAndSchedule();
		}, delayFor(delayMs));
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

export { delayFor, runProgram };
