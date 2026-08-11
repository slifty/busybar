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
