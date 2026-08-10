import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DRAW_PRIORITY } from "../config.ts";
import { runProgram, delayFor } from "../runner.ts";
import { createFakeBar } from "../test/bar.ts";
import type { FakeBar } from "../test/bar.ts";
import type { DrawResult, Program } from "../program.ts";

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

const PROGRAM_NAME = "test-program";
const STUB_ELEMENT_ID = "stub";

interface Running {
	readonly logs: string[];
	readonly finished: Promise<void>;
}

// A program that really draws, because half of what the runner does is decide
// what is on screen and in what order. A stub that only returned a result
// would leave every ordering question -- did the failure come down before the
// retry? -- untestable.
const stubProgram = (
	onDraw: (attempt: number) => Promise<DrawResult> = async () =>
		await Promise.resolve({}),
	start?: Program["start"],
): Program => {
	let attempts = 0;

	return {
		name: PROGRAM_NAME,
		description: "a program that exists to be run",
		start,
		draw: async ({ bar, applicationName }) => {
			attempts += 1;

			const result = await onDraw(attempts);

			await bar.DisplayDraw({
				application_name: applicationName,
				priority: DRAW_PRIORITY,
				elements: [
					{
						id: STUB_ELEMENT_ID,
						type: "text",
						text: "stub",
						font: "tiny",
						color: "#FFFFFFFF",
						display: "front",
						align: "center",
						x: 0,
						y: 0,
						timeout: 0,
					},
				],
			});

			return result;
		},
	};
};

// Starts the runner without waiting for it: it runs until interrupted, so a
// test drives it forward with the clock and then stops it.
const run = (fake: FakeBar, program: Program): Running => {
	const logs: string[] = [];

	const finished = runProgram(fake.bar, program, (message) => {
		logs.push(message);
	});

	return { logs, finished };
};

// Lets everything already scheduled settle, including the first draw.
const settle = async (): Promise<void> => {
	await vi.advanceTimersByTimeAsync(0);
};

const stop = async ({ finished }: Running): Promise<void> => {
	process.emit("SIGINT");

	await finished;
};

const drawsWith = ({ draws }: FakeBar, id: string): unknown[] =>
	draws.filter(({ elements }) => elements.some((element) => element.id === id));

const programDraws = (fake: FakeBar): unknown[] =>
	drawsWith(fake, STUB_ELEMENT_ID);

// A failure is drawn as one element per line, numbered, so what identifies it
// is the prefix rather than any single id.
const errorDraws = ({ draws }: FakeBar): unknown[] =>
	draws.filter(({ elements }) =>
		elements.some((element) => element.id.startsWith("error")),
	);

describe("runProgram", () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("draws as soon as it starts", async () => {
		const fake = createFakeBar();
		const running = run(fake, stubProgram());

		await settle();

		expect(programDraws(fake)).toHaveLength(1);

		await stop(running);
	});

	// Elements outlive the process that drew them, so whatever is on screen at
	// startup belongs to a run that is over -- most likely a failure the last
	// one left up deliberately.
	it("clears the screen before its first draw", async () => {
		const fake = createFakeBar();
		const running = run(fake, stubProgram());

		await settle();

		expect(fake.calls).toStrictEqual(["clear", "draw"]);
		expect(fake.clears[0]).toStrictEqual({ application_name: PROGRAM_NAME });

		await stop(running);
	});

	it("comes back when the program asked it to", async () => {
		const fake = createFakeBar();
		const running = run(
			fake,
			stubProgram(async () => await Promise.resolve({ nextDrawInMs: 1_000 })),
		);

		await settle();
		await vi.advanceTimersByTimeAsync(999);

		expect(programDraws(fake)).toHaveLength(1);

		await vi.advanceTimersByTimeAsync(1);

		expect(programDraws(fake)).toHaveLength(2);

		await stop(running);
	});

	// The device sustains what was drawn, so there is nothing to come back for.
	it("does not come back when the program asked for nothing", async () => {
		const fake = createFakeBar();
		const running = run(fake, stubProgram());

		await settle();
		await vi.advanceTimersByTimeAsync(60_000 * 10);

		expect(programDraws(fake)).toHaveLength(1);

		await stop(running);
	});

	it("clears what the program drew when it stops", async () => {
		const fake = createFakeBar();
		const running = run(fake, stubProgram());

		await settle();
		await stop(running);

		expect(fake.clears.at(-1)).toStrictEqual({
			application_name: PROGRAM_NAME,
		});
		expect(running.logs).toContain("display cleared");
	});

	describe("when a draw fails", () => {
		const failing = (): Program =>
			stubProgram(async () => await Promise.reject(failure()));

		it("says so, with the reason", async () => {
			const fake = createFakeBar();
			const running = run(fake, failing());

			await settle();

			expect(running.logs).toContain("draw failed: device said no");

			await stop(running);
		});

		it("puts the failure on the bar", async () => {
			const fake = createFakeBar();
			const running = run(fake, failing());

			await settle();

			expect(errorDraws(fake)).toHaveLength(1);

			await stop(running);
		});

		it("tries again on its own delay", async () => {
			const fake = createFakeBar();
			const running = run(fake, failing());

			await settle();
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

			expect(errorDraws(fake)).toHaveLength(2);

			await stop(running);
		});

		// The error is drawn under the program's own application name, and the
		// device gives a tie on priority to whichever application already holds
		// the screen -- so an error left up is one the program cannot draw over.
		it("takes the failure down before trying again", async () => {
			const fake = createFakeBar();
			const running = run(fake, failing());

			await settle();

			const beforeRetry = fake.calls.slice();

			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

			expect(fake.calls[beforeRetry.length]).toBe("clear");

			await stop(running);
		});

		it("stops saying so once a draw works again", async () => {
			const fake = createFakeBar();
			const running = run(
				fake,
				stubProgram(async (attempt) => {
					if (attempt === 1) {
						throw failure();
					}

					return await Promise.resolve({});
				}),
			);

			await settle();
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

			expect(running.logs).toContain("recovered");
			expect(errorDraws(fake)).toHaveLength(1);
			expect(programDraws(fake)).toHaveLength(1);

			await stop(running);
		});

		// Reporting a failure must not become a second failure: the device being
		// unreachable is one of the things it is trying to report.
		it("carries on when it cannot draw the failure either", async () => {
			const fake = createFakeBar();

			fake.drawRejectsWith = failure();

			const running = run(fake, stubProgram());

			await settle();

			expect(
				running.logs.some((line) =>
					line.startsWith("failed to show the failure"),
				),
			).toBe(true);

			await stop(running);
		});

		it("carries on when it cannot clear either", async () => {
			const fake = createFakeBar();

			fake.clearRejectsWith = failure();

			const running = run(fake, stubProgram());

			await settle();

			expect(
				running.logs.some((line) => line.startsWith("failed to clear")),
			).toBe(true);

			await stop(running);
		});

		// A drawing left behind outlives the process and blocks other
		// applications from the screen, so claiming the screen was cleared when
		// it was not would bury the one line worth acting on.
		it("does not claim the display was cleared when clearing failed", async () => {
			const fake = createFakeBar();
			const running = run(fake, stubProgram());

			await settle();

			fake.clearRejectsWith = failure();

			await stop(running);

			expect(running.logs).not.toContain("display cleared");
			expect(
				running.logs.some((line) => line.startsWith("failed to clear")),
			).toBe(true);
		});
	});

	describe("when a higher-priority app owns the screen", () => {
		const outranked = (): Program =>
			stubProgram(async () => await Promise.reject(preemption()));

		it("says so once rather than on every retry", async () => {
			const fake = createFakeBar();
			const running = run(fake, outranked());

			await settle();
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS * 3);

			const said = running.logs.filter((line) =>
				line.includes("higher-priority app"),
			);

			expect(said).toHaveLength(1);

			await stop(running);
		});

		// Being outranked is the device working as intended, not a failure -- and
		// the error could not be drawn over that app anyway.
		it("draws no error for it", async () => {
			const fake = createFakeBar();
			const running = run(fake, outranked());

			await settle();

			expect(errorDraws(fake)).toHaveLength(0);

			await stop(running);
		});

		it("says when it has the screen back", async () => {
			const fake = createFakeBar();
			const running = run(
				fake,
				stubProgram(async (attempt) => {
					if (attempt === 1) {
						throw preemption();
					}

					return await Promise.resolve({});
				}),
			);

			await settle();
			await vi.advanceTimersByTimeAsync(RETRY_DELAY_MS);

			expect(running.logs).toContain("regained the screen");

			await stop(running);
		});
	});

	describe("when preparation fails", () => {
		const unpreparable = (): Program =>
			stubProgram(
				async () => await Promise.resolve({}),
				async () => {
					await Promise.reject(new Error("no schedule"));
				},
			);

		it("stops the tool rather than retrying", async () => {
			const fake = createFakeBar();
			const running = run(fake, unpreparable());

			await expect(running.finished).rejects.toThrow(/no schedule/v);
			expect(programDraws(fake)).toHaveLength(0);
		});

		// The process is about to exit, so nothing is coming to clear it. A tool
		// that never started is exactly when the screen must not look ordinary.
		it("leaves the failure on the bar on its way out", async () => {
			const fake = createFakeBar();
			const running = run(fake, unpreparable());

			await expect(running.finished).rejects.toThrow();

			expect(errorDraws(fake)).toHaveLength(1);
			expect(fake.calls.at(-1)).toBe("draw");
		});
	});
});
