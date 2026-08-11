import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_DRAW_PRIORITY } from "../constants/device.ts";
// The tool's own way of putting an error into words, so that this asserts the
// line somebody would actually read rather than a message it half contains.
import { describe as describeError } from "../errors.ts";
import { delayFor } from "../runner.ts";
import { createFakeBar } from "../test/bar.ts";
import {
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
import type { Program } from "../program.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const RETRY_DELAY_MS = 5_000;

describe("delayFor", () => {
	it("passes an ordinary delay through untouched", () => {
		expect(delayFor(1_000)).toBe(1_000);
	});

	it("allows zero, which asks for a redraw as soon as possible", () => {
		expect(delayFor(0)).toBe(0);
	});

	// setTimeout keeps its delay in a signed 32-bit millisecond count, and
	// anything larger wraps round and fires immediately.
	it("caps a wait longer than setTimeout can express", () => {
		expect(delayFor(MAX_TIMEOUT_MS + 1)).toBe(MAX_TIMEOUT_MS);
		expect(delayFor(Number.MAX_SAFE_INTEGER)).toBe(MAX_TIMEOUT_MS);
	});

	it("never returns a delay setTimeout would fire immediately on", () => {
		for (const requested of [
			-1,
			-MAX_TIMEOUT_MS,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			MAX_TIMEOUT_MS * 2,
		]) {
			const delay = delayFor(requested);

			expect(Number.isFinite(delay)).toBe(true);
			expect(delay).toBeGreaterThanOrEqual(0);
			expect(delay).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
		}
	});

	it("floors a negative delay at zero rather than counting backwards", () => {
		expect(delayFor(-1)).toBe(0);
	});

	// A program cannot ask for these on purpose, so they are a bug rather than
	// a request. Retrying on the runner's own delay keeps the program alive
	// without spinning the event loop.
	it.each([
		["NaN", Number.NaN],
		["positive infinity", Number.POSITIVE_INFINITY],
		["negative infinity", Number.NEGATIVE_INFINITY],
	])("retries later when asked for %s", (_label, requested) => {
		expect(delayFor(requested)).toBe(RETRY_DELAY_MS);
	});
});

// The device rejects a draw with 409 when a higher-priority app owns the
// screen.
const preemption = (): Error =>
	Object.assign(new Error("conflict"), { status: 409 });

const failure = (): Error => new Error("device said no");

describe("runPrograms, running one program", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("draws as soon as it starts", async () => {
		const fake = createFakeBar();
		const running = startRun(fake, stubProgram());

		await settle();

		expect(programDraws(fake)).toHaveLength(1);

		await stopRun(running);
	});

	// Elements outlive the process that drew them, so whatever is on screen at
	// startup belongs to a run that is over -- most likely a failure the last
	// one left up deliberately.
	it("clears the screen before its first draw", async () => {
		const fake = createFakeBar();
		const running = startRun(fake, stubProgram());

		await settle();

		expect(fake.calls).toStrictEqual(["clear", "draw"]);
		expect(fake.clears[0]).toStrictEqual({
			application_name: STUB_PROGRAM_NAME,
		});

		await stopRun(running);
	});

	it("comes back when the program asked it to", async () => {
		const fake = createFakeBar();
		const running = startRun(
			fake,
			stubProgram({
				onDraw: async () => await Promise.resolve({ nextDrawInMs: 1_000 }),
			}),
		);

		await settle();
		await vi.advanceTimersByTimeAsync(999);

		expect(programDraws(fake)).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(1);

		expect(programDraws(fake)).toHaveLength(2);

		await stopRun(running);
	});

	// The device sustains what was drawn, so there is nothing to come back for.
	it("does not come back when the program asked for nothing", async () => {
		const fake = createFakeBar();
		const running = startRun(fake, stubProgram());

		await settle();
		await vi.advanceTimersByTimeAsync(60_000 * 10);

		expect(programDraws(fake)).toHaveLength(1);

		await stopRun(running);
	});

	it("clears what the program drew when it stops", async () => {
		const fake = createFakeBar();
		const running = startRun(fake, stubProgram());

		await settle();
		await stopRun(running);

		expect(fake.clears.at(-1)).toStrictEqual({
			application_name: STUB_PROGRAM_NAME,
		});
		expect(logsFrom(running)).toContain("display cleared");
	});

	// Every program reports through the same log, so a line that did not say
	// which one it came from would be a line about no program in particular.
	it("says which program each line of its log is about", async () => {
		const fake = createFakeBar();
		const running = startRun(fake, stubProgram());

		await settle();
		await stopRun(running);

		expect(running.logs).toContain(`${STUB_PROGRAM_NAME}: display cleared`);
	});

	describe("the priority a program draws at", () => {
		const interrupting = DEFAULT_DRAW_PRIORITY + 40;

		it("is the default when the program does not ask for one", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, stubProgram());

			await settle();

			expect(fake.draws[0]?.priority).toBe(DEFAULT_DRAW_PRIORITY);

			await stopRun(running);
		});

		it("is what the program asked for when it asked", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, stubProgram({ priority: interrupting }));

			await settle();

			expect(fake.draws[0]?.priority).toBe(interrupting);

			await stopRun(running);
		});

		// Otherwise the failure of the program that interrupts the others would
		// be the one failure they all draw over.
		it("is also what its failure is drawn at", async () => {
			const fake = createFakeBar();
			const running = startRun(
				fake,
				stubProgram({
					priority: interrupting,
					onDraw: async () => await Promise.reject(failure()),
				}),
			);

			await settle();

			expect(fake.draws[0]?.priority).toBe(interrupting);

			await stopRun(running);
		});
	});

	describe("when a draw fails", () => {
		const failing = (): Program =>
			stubProgram({ onDraw: async () => await Promise.reject(failure()) });

		it("says so, with the reason", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, failing());

			await settle();

			expect(logsFrom(running)).toContain("draw failed: device said no");

			await stopRun(running);
		});

		it("puts the failure on the bar", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, failing());

			await settle();

			expect(errorDraws(fake)).toHaveLength(1);

			await stopRun(running);
		});

		it("tries again on its own delay", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, failing());

			await settle();
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

			expect(errorDraws(fake)).toHaveLength(2);

			await stopRun(running);
		});

		// The error is drawn under the program's own application name, and the
		// device gives a tie on priority to whichever application already holds
		// the screen -- so an error left up is one the program cannot draw over.
		it("takes the failure down before trying again", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, failing());

			await settle();

			const beforeRetry = fake.calls.slice();

			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

			expect(fake.calls[beforeRetry.length]).toBe("clear");

			await stopRun(running);
		});

		it("stops saying so once a draw works again", async () => {
			const fake = createFakeBar();
			const running = startRun(
				fake,
				stubProgram({
					onDraw: async (attempt) => {
						if (attempt === 1) {
							throw failure();
						}

						return await Promise.resolve({});
					},
				}),
			);

			await settle();
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

			expect(logsFrom(running)).toContain("recovered");
			expect(errorDraws(fake)).toHaveLength(1);
			expect(programDraws(fake)).toHaveLength(1);

			await stopRun(running);
		});

		// Reporting a failure must not become a second failure: the device being
		// unreachable is one of the things it is trying to report.
		it("carries on when it cannot draw the failure either", async () => {
			const fake = createFakeBar();

			fake.drawRejectsWith = failure();

			const running = startRun(fake, stubProgram());

			await settle();

			expect(
				logsFrom(running).some((line) =>
					line.startsWith("failed to show the failure"),
				),
			).toBe(true);

			await stopRun(running);
		});

		it("carries on when it cannot clear either", async () => {
			const fake = createFakeBar();

			fake.clearRejectsWith = failure();

			const running = startRun(fake, stubProgram());

			await settle();

			expect(
				logsFrom(running).some((line) => line.startsWith("failed to clear")),
			).toBe(true);

			await stopRun(running);
		});

		// A drawing left behind outlives the process and blocks other
		// applications from the screen, so claiming the screen was cleared when
		// it was not would bury the one line worth acting on.
		it("does not claim the display was cleared when clearing failed", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, stubProgram());

			await settle();

			fake.clearRejectsWith = failure();

			await stopRun(running);

			expect(logsFrom(running)).not.toContain("display cleared");
			expect(
				logsFrom(running).some((line) => line.startsWith("failed to clear")),
			).toBe(true);
		});
	});

	describe("when a higher-priority app owns the screen", () => {
		const outranked = (): Program =>
			stubProgram({ onDraw: async () => await Promise.reject(preemption()) });

		it("says so once rather than on every retry", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, outranked());

			await settle();
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);

			const said = logsFrom(running).filter((line) =>
				line.includes("higher-priority app"),
			);

			expect(said).toHaveLength(1);

			await stopRun(running);
		});

		// Being outranked is the device working as intended, not a failure -- and
		// the error could not be drawn over that app anyway.
		it("draws no error for it", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, outranked());

			await settle();

			expect(errorDraws(fake)).toHaveLength(0);

			await stopRun(running);
		});

		it("says when it has the screen back", async () => {
			const fake = createFakeBar();
			const running = startRun(
				fake,
				stubProgram({
					onDraw: async (attempt) => {
						if (attempt === 1) {
							throw preemption();
						}

						return await Promise.resolve({});
					},
				}),
			);

			await settle();
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

			expect(logsFrom(running)).toContain("regained the screen");

			await stopRun(running);
		});
	});

	describe("when preparation fails", () => {
		const unpreparable = (): Program =>
			stubProgram({
				start: async () => {
					await Promise.reject(new Error("no schedule"));
				},
			});

		it("does not draw that program", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, unpreparable());

			await expect(running.finished).rejects.toThrow();

			expect(programDraws(fake)).toHaveLength(0);
		});

		it("says which program could not start, and why", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, unpreparable());

			await expect(running.finished).rejects.toThrow();

			expect(logsFrom(running)).toContain("could not start: no schedule");
		});

		// Nothing is coming back to clear it: this program will not run again,
		// and a program that never started is exactly when the screen must not
		// look ordinary.
		it("leaves the failure on the bar", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, unpreparable());

			await expect(running.finished).rejects.toThrow();

			expect(errorDraws(fake)).toHaveLength(1);
			expect(clearsOf(fake, STUB_PROGRAM_NAME)).toHaveLength(1);
			expect(fake.calls.at(-1)).toBe("draw");
		});

		// There is nothing left to interrupt and no reason to sit there looking
		// alive -- and the reason leaves with the tool rather than staying in a
		// log nobody is watching.
		it("stops the tool when nothing else is running, saying why", async () => {
			const fake = createFakeBar();
			const running = startRun(fake, unpreparable());

			const thrown = await running.finished.catch((error: unknown) => error);

			expect(describeError(thrown)).toBe("no program could start: no schedule");
		});
	});
});
