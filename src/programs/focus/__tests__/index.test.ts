import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../../../constants/time.ts";
import { createFakeBar } from "../../../test/bar.ts";
import { FOCUS_FILE_ENV_VAR } from "../blocks.ts";
import { colorFor } from "../focus.ts";
import { focus } from "../index.ts";
import type { BusyBar } from "@busy-app/busy-lib";
import type { ProgramContext } from "../../../program.ts";

type Elements = Parameters<BusyBar["DisplayDraw"]>[0]["elements"];
type Element = Elements[number];

const isText = (
	element: Element,
): element is Extract<Element, { type: "text" }> => element.type === "text";

const isCountdown = (
	element: Element,
): element is Extract<Element, { type: "countdown" }> =>
	element.type === "countdown";

const NOW = new Date("2026-01-01T09:14:00Z");
const BLOCK_START = new Date("2026-01-01T09:00:00Z");
const BLOCK_END = new Date("2026-01-01T10:00:00Z");
const NEXT_BLOCK_START = new Date("2026-01-01T11:00:00Z");

const unixSeconds = (date: Date): string =>
	String(Math.floor(date.getTime() / MS_PER_SECOND));

const directory = mkdtempSync(join(tmpdir(), "busybar-program-"));

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

beforeEach(() => {
	// Only the clock is faked, not the event loop -- these tests await real
	// file reads, and faking timers wholesale would stall them.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(NOW);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

const SCHEDULE = [
	{
		name: "Deep Work: Rendering Pipeline",
		start: BLOCK_START.toISOString(),
		end: BLOCK_END.toISOString(),
	},
	{
		name: "Email",
		start: NEXT_BLOCK_START.toISOString(),
		end: new Date("2026-01-01T11:30:00Z").toISOString(),
	},
];

// Points the program at a schedule and runs its one-time preparation, which is
// what a draw needs before it can answer anything.
const start = async (blocks: unknown = SCHEDULE): Promise<ProgramContext> => {
	const path = join(directory, `${String(Math.random()).slice(2)}.json`);

	await writeFile(path, JSON.stringify(blocks), "utf8");
	vi.stubEnv(FOCUS_FILE_ENV_VAR, path);

	const { bar } = createFakeBar();
	const context = { bar, applicationName: focus.name };

	await focus.start?.(context);

	return context;
};

describe("the focus program", () => {
	it("is registered under a device-safe application name", () => {
		expect(focus.name).toMatch(/^[a-zA-Z0-9._\-]+$/v);
	});

	it("prepares before it draws", () => {
		expect(focus.start).toBeDefined();
	});

	describe("while a block is running", () => {
		it("draws the block's name and a countdown, and nothing else", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			expect(fake.draws).toHaveLength(1);

			const { elements } = fake.draws[0] ?? { elements: [] };

			expect(elements.map(({ type }) => type).toSorted()).toStrictEqual([
				"countdown",
				"text",
			]);
		});

		it("draws under the program's own application name", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			expect(fake.draws[0]?.application_name).toBe(focus.name);
		});

		it("shows the sanitised block name", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			const text = (fake.draws[0]?.elements ?? []).find(isText);

			expect(text?.text).toBe("Deep Work: Rendering Pipeline");
		});

		it("lets a name too wide for the display scroll instead of clipping", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			const text = (fake.draws[0]?.elements ?? []).find(isText);

			expect(text?.width).toBeGreaterThan(0);
			expect(text?.scroll_rate).toBeGreaterThan(0);
		});

		it("counts down to the end of the block, which the device ticks itself", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			const countdown = (fake.draws[0]?.elements ?? []).find(isCountdown);

			expect(countdown?.timestamp).toBe(unixSeconds(BLOCK_END));
			expect(countdown?.direction).toBe("time_left");
		});

		// Expiring at the block's end means a process that dies mid-block cannot
		// leave a finished focus on screen.
		it("expires both elements when the block ends", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			for (const element of fake.draws[0]?.elements ?? []) {
				expect(element.display_until).toBe(unixSeconds(BLOCK_END));
				expect(element.timeout).toBeUndefined();
			}
		});

		it("draws the whole block in the colour of its current phase", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			const elements = fake.draws[0]?.elements ?? [];
			const text = elements.find(isText);
			const countdown = elements.find(isCountdown);

			expect(text?.color).toBe(colorFor("rampUp"));
			expect(countdown?.color).toBe(text?.color);
		});

		it.each([
			["ramp-up", 14, "rampUp"],
			["settled", 30, "settled"],
			["wind-down", 50, "windDown"],
		] as const)(
			"uses the %s colour when that far into the block",
			async (_label, minutesIn, phase) => {
				vi.setSystemTime(
					new Date(BLOCK_START.getTime() + minutesIn * MS_PER_MINUTE),
				);

				const fake = createFakeBar();
				const context = await start();

				await focus.draw({ ...context, bar: fake.bar });

				const text = (fake.draws[0]?.elements ?? []).find(isText);

				expect(text?.color).toBe(colorFor(phase));
			},
		);

		// A schedule can carry fractional seconds, and the device only accepts
		// whole ones. Rounding the wrong way would take the drawing off screen
		// before the block was actually over.
		it("never expires before the block ends, even on a fractional second", async () => {
			const end = new Date("2026-01-01T10:00:00.750Z");
			const fake = createFakeBar();
			const context = await start([
				{
					name: "Deep Work",
					start: BLOCK_START.toISOString(),
					end: end.toISOString(),
				},
			]);

			await focus.draw({ ...context, bar: fake.bar });

			const elements = fake.draws[0]?.elements ?? [];

			expect(elements).toHaveLength(2);

			for (const element of elements) {
				expect(
					Number(element.display_until) * MS_PER_SECOND,
				).toBeGreaterThanOrEqual(end.getTime());
			}

			const countdown = elements.find(isCountdown);

			expect(
				Number(countdown?.timestamp) * MS_PER_SECOND,
			).toBeGreaterThanOrEqual(end.getTime());
		});

		it("asks to be drawn again when the colour next changes, not sooner", async () => {
			const fake = createFakeBar();
			const context = await start();

			const result = await focus.draw({ ...context, bar: fake.bar });

			expect(result.nextDrawInMs).toBe(MS_PER_MINUTE);
		});
	});

	describe("between blocks", () => {
		beforeEach(() => {
			vi.setSystemTime(new Date("2026-01-01T10:30:00Z"));
		});

		it("draws nothing, leaving the screen to whatever else wants it", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			expect(fake.draws).toHaveLength(0);
		});

		it("waits for the next block to start", async () => {
			const fake = createFakeBar();
			const context = await start();

			const result = await focus.draw({ ...context, bar: fake.bar });

			expect(result.nextDrawInMs).toBe(NEXT_BLOCK_START.getTime() - Date.now());
		});
	});

	describe("once the schedule is spent", () => {
		beforeEach(() => {
			vi.setSystemTime(new Date("2026-01-01T23:00:00Z"));
		});

		it("draws nothing", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			expect(fake.draws).toHaveLength(0);
		});

		it("asks for no further draws at all", async () => {
			const fake = createFakeBar();
			const context = await start();

			const result = await focus.draw({ ...context, bar: fake.bar });

			expect(result.nextDrawInMs).toBeUndefined();
		});
	});

	describe("before it has been prepared", () => {
		it("refuses to draw rather than showing something wrong", async () => {
			vi.resetModules();

			const { focus: unprepared } = await import("../index.ts");
			const { bar } = createFakeBar();

			await expect(
				unprepared.draw({ bar, applicationName: unprepared.name }),
			).rejects.toThrow(/never loaded/v);
		});
	});
});
