import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bytesOf, messageField, numberField } from "../test/protobuf.ts";
import {
	OTHER_STUB_PROGRAM_NAME,
	logsFrom,
	programDraws,
	settle,
	startRun,
	stopRun,
	stubProgram,
} from "../test/runner.ts";
import { createFakeBar } from "../test/bar.ts";
import { fakeSockets } from "../test/socket.ts";
import type { InputResult } from "../program.ts";

// A state message carrying one press of `back`, as the device would send it.
const { buffer: BACK_PRESS } = bytesOf(
	messageField(2, messageField(11, messageField(1, numberField(1, 1)))),
);

// Long enough that any draw arriving before it was asked for by a press rather
// than by the clock.
const NEVER_SOON = 60_000;

const sockets = fakeSockets();

beforeEach(() => {
	vi.useFakeTimers();
	sockets.install();
});

afterEach(async () => {
	sockets.restore();
	await vi.runOnlyPendingTimersAsync();
	vi.useRealTimers();
});

// Delivers a press the way the device would: down the stream the runner opened.
const pressBack = async (): Promise<void> => {
	sockets.latest()?.open();
	sockets.latest()?.deliver(BACK_PRESS);

	await settle();
};

describe("runPrograms, and the bar's buttons", () => {
	// The stream is the tool's only non-HTTP connection to the device, so a run
	// of programs that none of them take presses does not open one.
	it("does not listen when no program takes presses", async () => {
		const fake = createFakeBar();
		const run = startRun(fake, stubProgram());

		await settle();

		expect(sockets.opened).toStrictEqual([]);

		await stopRun(run);
	});

	it("listens as soon as one program does", async () => {
		const fake = createFakeBar();
		const run = startRun(
			fake,
			stubProgram({ onButton: async () => await Promise.resolve({}) }),
		);

		await settle();

		expect(sockets.opened).toHaveLength(1);

		await stopRun(run);
	});

	it("hands a press to the program", async () => {
		const fake = createFakeBar();
		const pressed: string[] = [];
		const run = startRun(
			fake,
			stubProgram({
				onDraw: async () => await Promise.resolve({ nextDrawInMs: NEVER_SOON }),
				onButton: async (button) => {
					pressed.push(button);

					return await Promise.resolve({});
				},
			}),
		);

		await settle();
		await pressBack();

		expect(pressed).toStrictEqual(["back"]);

		await stopRun(run);
	});

	// The whole point of the hook: a press is heard while the program is
	// waiting, and brings the next draw forward to now.
	it("draws again when the press says the screen is now wrong", async () => {
		const fake = createFakeBar();
		const run = startRun(
			fake,
			stubProgram({
				onDraw: async () => await Promise.resolve({ nextDrawInMs: NEVER_SOON }),
				onButton: async () => await Promise.resolve({ redraw: true }),
			}),
		);

		await settle();

		expect(programDraws(fake)).toHaveLength(1);

		await pressBack();

		expect(programDraws(fake)).toHaveLength(2);

		await stopRun(run);
	});

	// Raised in review: could a press that lands *during* a draw be dropped,
	// between the loop's last check for one and the flag that says a draw is in
	// flight being cleared? It cannot -- nothing is awaited between those two,
	// so no other work can run in the gap -- but "cannot" is worth a test that
	// would fail if it ever could.
	it("draws again for a press that lands mid-draw", async () => {
		const fake = createFakeBar();
		const { promise: drawing, resolve: releaseDraw } =
			Promise.withResolvers<undefined>();

		let attempts = 0;
		const run = startRun(
			fake,
			stubProgram({
				onDraw: async () => {
					attempts += 1;

					// Only the first draw hangs, so the press arrives while it
					// is still in flight.
					if (attempts === 1) {
						await drawing;
					}

					return { nextDrawInMs: NEVER_SOON };
				},
				onButton: async () => await Promise.resolve({ redraw: true }),
			}),
		);

		await settle();

		expect(programDraws(fake)).toHaveLength(0);

		// The press lands while the first draw is still waiting.
		sockets.latest()?.open();
		sockets.latest()?.deliver(BACK_PRESS);
		await settle();

		releaseDraw(undefined);
		await settle();

		expect(programDraws(fake)).toHaveLength(2);

		await stopRun(run);
	});

	// Most presses are somebody using the bar for something else, and a program
	// that says a press changed nothing is not redrawn for it.
	it("leaves the schedule alone when the press changed nothing", async () => {
		const fake = createFakeBar();
		const run = startRun(
			fake,
			stubProgram({
				onDraw: async () => await Promise.resolve({ nextDrawInMs: NEVER_SOON }),
				onButton: async () => await Promise.resolve({}),
			}),
		);

		await settle();
		await pressBack();

		expect(programDraws(fake)).toHaveLength(1);

		await stopRun(run);
	});

	// The device has three buttons and no notion of what is on screen, so
	// deciding whether a press was meant for you is the program's own business.
	it("tells every listening program about every press", async () => {
		const fake = createFakeBar();
		const heard: string[] = [];
		const listener = (name: string) => async (): Promise<InputResult> => {
			heard.push(name);

			return await Promise.resolve({});
		};

		const run = startRun(
			fake,
			stubProgram({ onButton: listener("first") }),
			stubProgram({
				name: OTHER_STUB_PROGRAM_NAME,
				onButton: listener("second"),
			}),
		);

		await settle();
		await pressBack();

		expect(heard).toStrictEqual(["first", "second"]);

		await stopRun(run);
	});

	// A press is not a draw: there is no screen to leave broken and nothing to
	// retry against, so a handler that throws is reported and the run goes on.
	// The alternative would make the button the least reliable thing on the bar.
	it("carries on when a program's handler throws", async () => {
		const fake = createFakeBar();
		const run = startRun(
			fake,
			stubProgram({
				onDraw: async () => await Promise.resolve({ nextDrawInMs: NEVER_SOON }),
				onButton: async () => {
					await Promise.resolve();

					throw new Error("TEST handler failed");
				},
			}),
		);

		await settle();
		await pressBack();

		expect(logsFrom(run).join(" ")).toMatch(
			/could not handle the back button/v,
		);

		await stopRun(run);
	});

	// The socket would otherwise hold the process open past Ctrl-C.
	it("closes the stream when the run stops", async () => {
		const fake = createFakeBar();
		const run = startRun(
			fake,
			stubProgram({ onButton: async () => await Promise.resolve({}) }),
		);

		await settle();
		sockets.latest()?.open();

		await stopRun(run);

		expect(sockets.latest()?.closedByUs()).toBe(true);
	});
});
