import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeBar } from "../test/bar.ts";
import {
	OTHER_STUB_PROGRAM_NAME,
	STUB_PROGRAM_NAME,
	clearsOf,
	errorDraws,
	logsFrom,
	programDraws,
	settle,
	startRun,
	stopRun,
	stubProgram,
} from "../test/runner.ts";
import type { ProgramContext } from "../program.ts";

const RETRY_DELAY_MS = 5_000;

const failure = (): Error => new Error("device said no");

const other = (): ReturnType<typeof stubProgram> =>
	stubProgram({ name: OTHER_STUB_PROGRAM_NAME });

// Programs run alongside each other rather than taking turns: each draws when
// it has something to say, and the device decides which of them is actually on
// screen by comparing priorities.
describe("runPrograms, running several at once", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("runs them all", async () => {
		const fake = createFakeBar();
		const running = startRun(fake, stubProgram(), other());

		await settle();

		expect(programDraws(fake)).toHaveLength(1);
		expect(programDraws(fake, OTHER_STUB_PROGRAM_NAME)).toHaveLength(1);

		await stopRun(running);
	});

	// Elements are namespaced by application name, so each program's drawings
	// come down without disturbing the others'.
	it("clears each of them under its own name when it stops", async () => {
		const fake = createFakeBar();
		const running = startRun(fake, stubProgram(), other());

		await settle();
		await stopRun(running);

		expect(logsFrom(running)).toContain("display cleared");
		expect(logsFrom(running, OTHER_STUB_PROGRAM_NAME)).toContain(
			"display cleared",
		);
	});

	// Each keeps its own schedule: one asking to be left alone must not stop
	// the other being drawn again.
	it("keeps drawing one while the other waits", async () => {
		const fake = createFakeBar();
		const running = startRun(
			fake,
			stubProgram(),
			stubProgram({
				name: OTHER_STUB_PROGRAM_NAME,
				onDraw: async () => await Promise.resolve({ nextDrawInMs: 1_000 }),
			}),
		);

		await settle();
		await vi.advanceTimersByTimeAsync(3_000);

		expect(programDraws(fake)).toHaveLength(1);
		expect(programDraws(fake, OTHER_STUB_PROGRAM_NAME)).toHaveLength(4);

		await stopRun(running);
	});

	// A failing program is not a reason to take a working one down with it.
	it("carries on with the rest when one keeps failing", async () => {
		const fake = createFakeBar();
		const running = startRun(
			fake,
			stubProgram({ onDraw: async () => await Promise.reject(failure()) }),
			other(),
		);

		await settle();
		await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 2);

		expect(errorDraws(fake)).not.toHaveLength(0);
		expect(programDraws(fake, OTHER_STUB_PROGRAM_NAME)).toHaveLength(1);

		await stopRun(running);
	});

	// Preparation reads files and fetches calendars, and one program's slow
	// network is no reason to hold up another's first draw. The wait here is
	// only ended by the other program's own preparation, so a runner that
	// prepared them in turn would never reach the second one at all.
	it("prepares them all at once rather than in turn", async () => {
		const fake = createFakeBar();
		const { promise: slow, resolve: released } =
			Promise.withResolvers<undefined>();

		const running = startRun(
			fake,
			stubProgram({
				start: async () => {
					await slow;
				},
			}),
			stubProgram({
				name: OTHER_STUB_PROGRAM_NAME,
				start: async () => {
					released(undefined);

					await Promise.resolve();
				},
			}),
		);

		await settle();

		expect(programDraws(fake)).toHaveLength(1);
		expect(programDraws(fake, OTHER_STUB_PROGRAM_NAME)).toHaveLength(1);

		await stopRun(running);
	});

	describe("when one of them cannot start", () => {
		const unpreparable = (): ReturnType<typeof stubProgram> =>
			stubProgram({
				start: async () => {
					await Promise.reject(new Error("no schedule"));
				},
			});

		// Two programs are two requests, and a missing schedule is no reason to
		// take a meeting alert down with it.
		it("runs the ones that did", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, unpreparable(), other());

			await settle();

			expect(programDraws(fake, OTHER_STUB_PROGRAM_NAME)).toHaveLength(1);
			expect(errorDraws(fake)).toHaveLength(1);

			await stopRun(running);
		});

		// The one that never started is not this run's to clean up: its failure
		// is the last thing it drew, and it is meant to stay.
		it("clears only what the programs it ran had drawn", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, unpreparable(), other());

			await settle();

			const { length: clearedBeforeStopping } = clearsOf(
				fake,
				STUB_PROGRAM_NAME,
			);

			await stopRun(running);

			expect(clearsOf(fake, STUB_PROGRAM_NAME)).toHaveLength(
				clearedBeforeStopping,
			);
			expect(logsFrom(running, OTHER_STUB_PROGRAM_NAME)).toContain(
				"display cleared",
			);
		});
	});
});

// The device destroys a lower-priority application's elements rather than
// hiding them behind a higher-priority one, and never puts them back. Their
// owner cannot tell: its own draw succeeded, so it never saw the 409 that would
// have had the runner retry. So the program that interrupted has to say when it
// is finished, and the runner is what turns that into draws.
describe("runPrograms, when a program lets the screen go", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	// Long enough that any draw arriving before it was asked for rather than
	// scheduled.
	const NEVER_SOON = 60 * 60 * 1_000;

	const capture = (): {
		readonly of: (context: ProgramContext) => Promise<void>;
		readonly context: () => ProgramContext | undefined;
	} => {
		let captured: ProgramContext | undefined = undefined;

		return {
			of: async (context) => {
				captured = context;

				await Promise.resolve();
			},
			context: () => captured,
		};
	};

	it("draws every other program again", async () => {
		const fake = createFakeBar();
		const interrupter = capture();
		const running = startRun(
			fake,
			stubProgram({
				start: interrupter.of,
				onDraw: async () => await Promise.resolve({ nextDrawInMs: NEVER_SOON }),
			}),
			stubProgram({
				name: OTHER_STUB_PROGRAM_NAME,
				onDraw: async () => await Promise.resolve({ nextDrawInMs: NEVER_SOON }),
			}),
		);

		await settle();

		expect(programDraws(fake, OTHER_STUB_PROGRAM_NAME)).toHaveLength(1);

		interrupter.context()?.releaseScreen();
		await settle();

		expect(programDraws(fake, OTHER_STUB_PROGRAM_NAME)).toHaveLength(2);

		await stopRun(running);
	});

	// Waking the caller as well would have a program that has just cleared the
	// screen immediately draw over whatever it was making room for.
	it("does not draw the program that let it go", async () => {
		const fake = createFakeBar();
		const interrupter = capture();
		const running = startRun(
			fake,
			stubProgram({
				start: interrupter.of,
				onDraw: async () => await Promise.resolve({ nextDrawInMs: NEVER_SOON }),
			}),
			stubProgram({ name: OTHER_STUB_PROGRAM_NAME }),
		);

		await settle();
		interrupter.context()?.releaseScreen();
		await settle();

		expect(programDraws(fake)).toHaveLength(1);

		await stopRun(running);
	});

	// A program that asked never to be drawn again is exactly the one that
	// needs waking: it is asleep until something it cannot see happens.
	it("draws a program that had asked not to be drawn again", async () => {
		const fake = createFakeBar();
		const sleeper = capture();
		const running = startRun(
			fake,
			stubProgram({
				start: sleeper.of,
				onDraw: async () => await Promise.resolve({}),
			}),
		);

		await settle();

		expect(programDraws(fake)).toHaveLength(1);

		sleeper.context()?.redraw();
		await settle();

		expect(programDraws(fake)).toHaveLength(2);

		await stopRun(running);
	});

	// Nothing is listening yet -- the draw loops do not exist until every
	// program has been prepared -- and asking for a draw then must not throw.
	it("ignores a wake-up asked for before the run has started", async () => {
		const fake = createFakeBar();
		const running = startRun(
			fake,
			stubProgram({
				start: async (context) => {
					context.redraw();
					context.releaseScreen();

					await Promise.resolve();
				},
			}),
		);

		await settle();

		expect(programDraws(fake)).toHaveLength(1);

		await stopRun(running);
	});
});
