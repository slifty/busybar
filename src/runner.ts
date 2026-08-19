import { once } from "node:events";
import { DEFAULT_DRAW_PRIORITY } from "./constants/device.ts";
import { clearApplication, isPreempted, showError } from "./display.ts";
import { describe } from "./errors.ts";
import { watchButtons } from "./input/stream.ts";
import type { BusyBar } from "@busy-app/busy-lib";
import type { Config } from "./config/index.ts";
import type { Button } from "./input/buttons.ts";
import type { Program, ProgramContext } from "./program.ts";

// Node exits as soon as nothing is scheduled, and a registered signal handler
// does not count as scheduled work. A program waiting on its next draw is held
// open by that timer, but one that has asked never to be drawn again is not.
// The length is irrelevant -- only the timer's existence matters.
const KEEP_ALIVE_INTERVAL_MS = 60_000;

// How long to wait before drawing again after a draw fails.
//
// A failure is not the program's decision, so it does not get to schedule
// around it: whatever it asked for described a successful draw. Coming back on
// a short fixed delay means a program preempted by a focus session -- or by
// another program of ours drawing over it -- takes the screen back shortly
// after that ends, rather than staying dark.
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

// How many programs are left when every one of them failed to prepare.
const NONE_STARTED = 0;

// Anything can be thrown, but only an Error carries a cause worth keeping.
const asError = (error: unknown): Error =>
	error instanceof Error ? error : new Error(describe(error));

// A program and everything the runner hands it.
interface Running {
	readonly program: Program;
	readonly context: ProgramContext;
}

// Which program a line of log came from.
//
// Programs run alongside each other and report through the same log, so
// without this "regained the screen" says nothing about who regained it. The
// name is the one every other part of the tool already identifies a program
// by: its application name on the device, and its block in the config file.
const scopedLog =
	(log: (message: string) => void, name: string) =>
	(message: string): void => {
		log(`${name}: ${message}`);
	};

// Every running program's "draw now", by name.
//
// It is a registry rather than a list of handles because the contexts are built
// before the draw loops they belong to: a program is handed its context when it
// is prepared, and preparation happens before anything draws. Reading the
// registry at the moment a program asks to be woken, rather than closing over a
// handle that does not exist yet, is what lets those two orders coexist.
type Wakeups = Map<string, () => void>;

// Everything a program is handed that is the same for all of them.
interface Environment {
	readonly bar: BusyBar;
	readonly config: Config;
	readonly log: (message: string) => void;
	readonly wakeups: Wakeups;
}

const runningProgram = (
	program: Program,
	{ bar, config, log, wakeups }: Environment,
): Running => ({
	program,
	context: {
		bar,
		applicationName: program.name,
		config: config.forProgram(program.name),
		// Resolved once, here, so that everything drawing on the program's
		// behalf -- the program itself, and the runner's failure report --
		// agrees about how loudly it speaks.
		priority: program.priority ?? DEFAULT_DRAW_PRIORITY,
		log: scopedLog(log, program.name),
		redraw: () => {
			wakeups.get(program.name)?.();
		},
		// Everyone but the program that released it. Waking the caller as well
		// would have a program that has just cleared the screen immediately
		// draw over whatever it was making room for.
		releaseScreen: () => {
			for (const [name, wake] of wakeups) {
				if (name !== program.name) {
					wake();
				}
			}
		},
	},
});

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
const clearDrawing = async ({
	bar,
	applicationName,
	log,
}: ProgramContext): Promise<boolean> => {
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
const cleanUp = async (context: ProgramContext): Promise<void> => {
	if (await clearDrawing(context)) {
		context.log("display cleared");
	}
};

// Reporting a failure must not become a second failure.
//
// The device being unreachable is one of the things this is here to report, so
// it is also one of the ways drawing the report can itself fail. Either way
// the terminal already has the original error; this only ever adds to it.
const showFailure = async ({
	bar,
	applicationName,
	priority,
	log,
}: ProgramContext): Promise<void> => {
	try {
		await showError(bar, applicationName, priority);
	} catch (error) {
		log(`failed to show the failure on the display: ${describe(error)}`);
	}
};

// Prepares one program, reporting what stopped it if anything did.
//
// Failing here is fatal to this program, unlike failing a draw. A draw fails
// for reasons that pass -- another program owns the screen, a request times
// out -- so the runner retries. Preparation fails because the program cannot do
// its job at all, and retrying that forever only buries the reason.
//
// It is not fatal to the other programs, though: they were asked for
// separately and there is no reason a missing schedule should take a meeting
// alert down with it. The failure goes on the bar under this program's own
// name and stays there, because a program that never started is precisely the
// case where the screen must not look ordinary -- and nothing is coming back
// later to clear it, since this program will not run again.
//
// A setting the program never read is a failure of the same kind, and is
// checked here because this is the moment every program has read the ones it
// does take. Nothing central knows what `focus` is configured by, so this is
// the only place a misspelled setting can be caught -- and it has to be
// caught, since the alternative is a line in the file that plainly says what
// the bar should do and is silently doing nothing.
const startProgram = async ({
	program,
	context,
}: Running): Promise<Error | undefined> => {
	try {
		await program.start?.(context);
		context.config.done();

		return undefined;
	} catch (error) {
		const failure = asError(error);

		context.log(`could not start: ${describe(failure)}`);
		await showFailure(context);

		return failure;
	}
};

// One running program, as everything outside its draw loop sees it.
interface Drawing {
	// Settles when the run is over and whatever the program drew is cleared.
	readonly finished: Promise<void>;
	// Hands the program a press of one of the bar's buttons. Does nothing for
	// a program that does not take them.
	readonly press: (button: Button) => Promise<void>;
}

// Draws one program until the run is stopped, then clears what it drew.
const runProgram = (
	{ program, context }: Running,
	signal: AbortSignal,
	aborted: Promise<void>,
	wakeups: Wakeups,
): Drawing => {
	// Losing the screen to a focus session, or to a program of ours that
	// outranks this one, is expected and can persist for as long as that lasts.
	// Reporting the transitions keeps a program that retries every few seconds
	// from filling the log with the same line.
	let preempted = false;

	// Whether a failure is currently on screen. Read before an await and
	// written after one, which `require-atomic-updates` flags -- rightly in
	// general, though not here: a program's draws never overlap, because each
	// one schedules the next only once it has finished.
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
			await clearDrawing(context);
		}

		try {
			const { nextDrawInMs } = await program.draw(context);

			if (preempted) {
				preempted = false;
				context.log("regained the screen");
			}

			// A draw that works is the only thing that ends a run of failures,
			// so an error is on screen for exactly as long as the tool is
			// actually broken.
			if (failing) {
				failing = false;
				context.log("recovered");
			}

			return nextDrawInMs;
		} catch (error) {
			// A focus session outranks us, as does any program of ours drawing
			// at a higher priority, and transient request failures happen even
			// over USB. None of it is worth exiting over.
			if (isPreempted(error)) {
				if (!preempted) {
					preempted = true;
					context.log("a higher-priority app owns the screen; still trying");
				}
			} else {
				context.log(`draw failed: ${describe(error)}`);

				// Put back after every failed attempt, not only the first,
				// because each attempt takes it down again on the way in.
				// eslint-disable-next-line require-atomic-updates -- a program's draws never overlap, so there is no interleaved update to lose
				failing = true;
				await showFailure(context);
			}

			return RETRY_DELAY_MS;
		}
	};

	// Whether a draw is in flight, and whether one was asked for while it was.
	//
	// Draws must never overlap: they reuse the same element ids, so two in
	// flight at once race to say what the last one of them left on screen.
	// The draw loop alone could not do that -- it schedules the next draw only
	// once the last has finished -- but a button press can arrive at any
	// moment, and the whole point of it is that it does not wait for the
	// scheduled draw. So a press that lands mid-draw asks for another one
	// after it rather than starting its own.
	let drawing = false;
	let redrawWanted = false;

	// Both of these are read through a call rather than directly, because both
	// change while a draw is awaited -- a press arrives, or the run is stopped
	// -- and TypeScript's narrowing cannot see either happen. Read inline, the
	// linter is right that the value it can prove is the only one there is; the
	// call is what says otherwise.
	const stopping = (): boolean => signal.aborted;

	const redrawRequested = (): boolean => {
		const wanted = redrawWanted;

		redrawWanted = false;

		return wanted;
	};

	const drawAndSchedule = async (): Promise<void> => {
		if (drawing) {
			redrawWanted = true;

			return;
		}

		drawing = true;

		try {
			do {
				// Whatever was scheduled is being drawn now instead, and a
				// timer left running would draw it a second time.
				clearTimeout(nextDraw);

				// eslint-disable-next-line no-await-in-loop -- the point of the loop is that a draw asked for during a draw happens after it, not alongside it
				const delayMs = await drawOnce();

				// A program that wants no further draws leaves nothing
				// scheduled, and there is no point scheduling a draw we are
				// already shutting down on.
				if (delayMs === undefined || stopping()) {
					continue;
				}

				if (!Number.isFinite(delayMs)) {
					context.log(
						`ignoring an impossible next-draw delay of ${String(delayMs)}`,
					);
				}

				// eslint-disable-next-line require-atomic-updates -- only this loop assigns it, and the guard above is what keeps two of them from running at once
				nextDraw = setTimeout(() => {
					void drawAndSchedule();
				}, delayFor(delayMs));
			} while (redrawRequested());
		} finally {
			// eslint-disable-next-line require-atomic-updates -- nothing else sets this; the guard above is what makes that true
			drawing = false;
		}
	};

	// Hands one press to the program, if it takes them.
	//
	// A press is not a draw and cannot fail like one: there is no screen to
	// leave broken and nothing to retry against, so a handler that throws is
	// logged and the run carries on. The alternative -- a press taking the
	// program down -- would make the button the least reliable thing on the
	// bar.
	const press = async (button: Button): Promise<void> => {
		if (program.onButton === undefined || stopping()) {
			return;
		}

		try {
			const { redraw = false } = await program.onButton(button, context);

			if (redraw && !stopping()) {
				await drawAndSchedule();
			}
		} catch (error) {
			context.log(`could not handle the ${button} button: ${describe(error)}`);
		}
	};

	// Registered before the first draw, so that a program woken by another one's
	// release during that draw is not missed.
	wakeups.set(program.name, () => {
		void drawAndSchedule();
	});

	const finished = (async (): Promise<void> => {
		// Nothing this run drew is on screen yet, so anything that is belongs
		// to a run that is over -- most likely a failure the last one left up
		// on its way out, which is exactly what it was left there for. Having
		// been seen, it goes, rather than sitting underneath everything this
		// run draws over it.
		await clearDrawing(context);

		try {
			await drawAndSchedule();
			await aborted;
		} finally {
			wakeups.delete(program.name);
			clearTimeout(nextDraw);
			await cleanUp(context);
		}
	})();

	return { finished, press };
};

// Runs programs until SIGINT or SIGTERM, then clears whatever they drew.
//
// Everything that is the same for every program lives here: drawing, honouring
// the program's request for when to draw next, tolerating preemption, and
// cleanup on the way out. Programs are otherwise independent -- they are not
// told about each other, they do not take turns, and one failing is not the
// others' problem. What is on screen at any moment is whichever of them the
// device last accepted a draw from, which is decided by priority alone.
const runPrograms = async (
	bar: BusyBar,
	programs: Program[],
	config: Config,
	log: (message: string) => void,
): Promise<void> => {
	const wakeups: Wakeups = new Map();

	const environment: Environment = { bar, config, log, wakeups };
	const entries = programs.map((program) =>
		runningProgram(program, environment),
	);

	// Held open from here rather than from the first draw, because preparation
	// waits too. A calendar that answered badly is asked again after a pause,
	// and that pause is deliberately not a reason to stay running -- so a
	// program whose whole preparation is one backing-off feed has nothing
	// scheduled, and a process with nothing scheduled exits. Without this it
	// would do so silently, part-way through starting up. See `wait` in
	// `src/calendar/source.ts`.
	const keepAlive = setInterval(() => {
		// Nothing to do; this only holds the event loop open.
	}, KEEP_ALIVE_INTERVAL_MS);

	// Before anything is scheduled or drawn, and all at once rather than in
	// turn: preparation reads files and fetches calendars, and one program's
	// slow network is not a reason to hold up another's first draw. Nothing is
	// running to stop until they have all come back, which is why the tool only
	// invites Ctrl-C afterwards.
	const outcomes = await Promise.all(
		entries.map(async (entry) => ({
			entry,
			error: await startProgram(entry),
		})),
	);

	const started = outcomes
		.filter(({ error }) => error === undefined)
		.map(({ entry }) => entry);

	// Nothing started, so there is nothing to interrupt and no reason to sit
	// there looking alive. Each reason has already been logged and drawn; the
	// first is carried out as well so that the process exits saying something
	// more useful than that it failed.
	if (started.length === NONE_STARTED) {
		clearInterval(keepAlive);

		const [failure] = outcomes
			.map(({ error }) => error)
			.filter((error) => error !== undefined);

		throw new Error("no program could start", { cause: failure });
	}

	log("press Ctrl-C to stop");

	const controller = new AbortController();

	// One listener, awaited by every program, and attached before the first
	// draw rather than after it: `once` on an already-aborted signal never
	// resolves, so a Ctrl-C arriving during that draw would otherwise leave the
	// tool waiting for an abort that had already happened.
	const aborted = once(controller.signal, "abort").then(() => undefined);

	const stop = (): void => {
		controller.abort();
	};

	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	const drawings = started.map((entry) => ({
		entry,
		drawing: runProgram(entry, controller.signal, aborted, wakeups),
	}));

	// One connection for the whole run, and only when something is listening.
	//
	// It is the tool's only non-HTTP connection to the bar, the device caps how
	// many clients may hold one at once, and every program that takes presses
	// wants the same stream -- so the runner owns it for the same reason it
	// owns the draw loop, and a run of programs that none of them take presses
	// never opens it at all.
	if (started.some(({ program }) => program.onButton !== undefined)) {
		watchButtons({
			address: config.deviceAddress,
			onPress: (button) => {
				// Every listening program hears every press. Nothing here knows
				// which of them a press was meant for, and the device knows
				// less -- it has three buttons and no notion of what is on
				// screen -- so deciding is the program's own business.
				for (const { drawing } of drawings) {
					void drawing.press(button);
				}
			},
			log,
			signal: controller.signal,
		});
	}

	try {
		// Each program runs to the end of the run and cleans up after itself.
		// Nothing in a draw loop is expected to escape it -- failures are drawn
		// and retried rather than thrown -- but one that did must not stop the
		// others being waited for, and cleaned up, on the way out.
		await Promise.all(
			drawings.map(async ({ entry, drawing }) => {
				try {
					await drawing.finished;
				} catch (error) {
					entry.context.log(describe(error));
				}
			}),
		);
	} finally {
		clearInterval(keepAlive);

		// The handlers belong to this run, not to the process: leaving them
		// registered would have a second run's Ctrl-C also abort the first
		// one's controller, which nothing is listening to any more.
		process.off("SIGINT", stop);
		process.off("SIGTERM", stop);
	}
};

export { delayFor, runPrograms };
