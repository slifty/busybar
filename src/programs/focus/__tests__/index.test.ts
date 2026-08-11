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
import { DEFAULT_DRAW_PRIORITY } from "../../../config.ts";
import {
	MS_PER_HOUR,
	MS_PER_MINUTE,
	MS_PER_SECOND,
} from "../../../constants/time.ts";
import { createFakeBar } from "../../../test/bar.ts";
import { FOCUS_FILE_ENV_VAR } from "../blocks.ts";
import { colorFor } from "../focus.ts";
import { IDLE_REFRESH_MS, focus } from "../index.ts";
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

const isRectangle = (
	element: Element,
): element is Extract<Element, { type: "rectangle" }> =>
	element.type === "rectangle";

// The name is drawn as one element per line, so what it says is the lines put
// back together.
const drawnName = (elements: Elements): string =>
	elements
		.filter(isText)
		.map(({ text }) => text)
		.join(" ")
		.trim();

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

// Named for what each block is testing rather than for a working day: a
// fixture wearing a real title is one screenshot away from being read as a
// real schedule, which is a mistake this repository has already paid for.
const SCHEDULE = [
	{
		name: "TEST a name that needs two lines",
		start: BLOCK_START.toISOString(),
		end: BLOCK_END.toISOString(),
	},
	{
		name: "TEST the next block",
		start: NEXT_BLOCK_START.toISOString(),
		end: new Date("2026-01-01T11:30:00Z").toISOString(),
	},
];

// A schedule file of its own per test, so one rewriting its schedule cannot
// disturb another.
const scheduleFile = (): string =>
	join(directory, `${String(Math.random()).slice(2)}.json`);

// Points the program at a schedule and runs its one-time preparation. The path
// is worth naming when a test means to rewrite the file underneath the program.
const start = async (
	blocks: unknown = SCHEDULE,
	path: string = scheduleFile(),
): Promise<ProgramContext> => {
	await writeFile(path, JSON.stringify(blocks), "utf8");
	vi.stubEnv(FOCUS_FILE_ENV_VAR, path);

	const { bar } = createFakeBar();
	const context = {
		bar,
		applicationName: focus.name,
		priority: DEFAULT_DRAW_PRIORITY,
		log: () => {
			// Nothing here cares what the program had to say.
		},
	};

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
		it("draws a frame, the block's name, and a countdown, in one go", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			expect(fake.draws).toHaveLength(1);

			const { elements } = fake.draws[0] ?? { elements: [] };

			expect(elements.filter(isRectangle)).toHaveLength(1);
			expect(elements.filter(isCountdown)).toHaveLength(1);
			expect(elements.filter(isText).length).toBeGreaterThan(0);
		});

		// Element ids stay on the device until they expire or are drawn over,
		// so a draw that used fewer lines than the one before it would leave
		// the extra line stranded on screen unless every slot goes out every
		// time.
		it("draws the same elements whether or not the name uses every line", async () => {
			const short = createFakeBar();
			const long = createFakeBar();

			await focus.draw({ ...(await start()), bar: short.bar });
			await focus.draw({
				...(await start([
					{
						name: "TEST a name far too long to hold in full",
						start: BLOCK_START.toISOString(),
						end: BLOCK_END.toISOString(),
					},
				])),
				bar: long.bar,
			});

			const ids = ({ elements }: { elements: Elements }): string[] =>
				elements.map(({ id }) => id).toSorted();

			expect(ids(short.draws[0] ?? { elements: [] })).toStrictEqual(
				ids(long.draws[0] ?? { elements: [] }),
			);
		});

		it("draws under the program's own application name", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			expect(fake.draws[0]?.application_name).toBe(focus.name);
		});

		it("shows the sanitised block name", async () => {
			const fake = createFakeBar();
			const context = await start([
				{
					name: "TEST — em dash",
					start: BLOCK_START.toISOString(),
					end: BLOCK_END.toISOString(),
				},
			]);

			await focus.draw({ ...context, bar: fake.bar });

			expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST em dash");
		});

		// A name you have to wait for is a name you cannot glance at, and any
		// redraw would jerk the scroll back to the beginning besides.
		it("never scrolls the name", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			for (const text of (fake.draws[0]?.elements ?? []).filter(isText)) {
				expect(text.width).toBeUndefined();
				expect(text.scroll_rate).toBeUndefined();
			}
		});

		it("breaks a long name across lines rather than cutting it short", async () => {
			const fake = createFakeBar();
			const context = await start([
				{
					name: "TEST wraps here",
					start: BLOCK_START.toISOString(),
					end: BLOCK_END.toISOString(),
				},
			]);

			await focus.draw({ ...context, bar: fake.bar });

			const lines = (fake.draws[0]?.elements ?? [])
				.filter(isText)
				.filter(({ text }) => text.trim() !== "");

			expect(lines).toHaveLength(2);
			expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST wraps here");
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
		it("expires every element when the block ends", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			for (const element of fake.draws[0]?.elements ?? []) {
				expect(element.display_until).toBe(unixSeconds(BLOCK_END));
				expect(element.timeout).toBeUndefined();
			}
		});

		// The phase is carried by the frame and the clock, so that the name is
		// never dimmed by the colour it is drawn in.
		it("puts the phase colour on the frame and the countdown, and leaves the name white", async () => {
			const fake = createFakeBar();
			const context = await start();

			await focus.draw({ ...context, bar: fake.bar });

			const elements = fake.draws[0]?.elements ?? [];

			expect(elements.find(isRectangle)?.border_color).toBe(colorFor("rampUp"));
			expect(elements.find(isCountdown)?.color).toBe(colorFor("rampUp"));

			for (const text of elements.filter(isText)) {
				expect(text.color.toUpperCase()).toBe("#FFFFFFFF");
			}
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

				const border = (fake.draws[0]?.elements ?? []).find(isRectangle);

				expect(border?.border_color).toBe(colorFor(phase));
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
					name: "TEST",
					start: BLOCK_START.toISOString(),
					end: end.toISOString(),
				},
			]);

			await focus.draw({ ...context, bar: fake.bar });

			const elements = fake.draws[0]?.elements ?? [];

			expect(elements.length).toBeGreaterThan(0);

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

		// The countdown drops its hours an hour from the end and gets 10px
		// narrower, which is 10px the name can have back -- but only if the
		// program comes back to redraw it.
		it("asks to be drawn again when the countdown loses its hours", async () => {
			const now = new Date("2026-01-01T09:30:00Z");
			const end = new Date("2026-01-01T12:00:00Z");

			vi.setSystemTime(now);

			const fake = createFakeBar();
			const context = await start([
				{
					name: "TEST",
					start: BLOCK_START.toISOString(),
					end: end.toISOString(),
				},
			]);

			const result = await focus.draw({ ...context, bar: fake.bar });
			const wakesAt = now.getTime() + (result.nextDrawInMs ?? 0);

			// Just past the hour mark, rather than on it: the device runs the
			// countdown off its own clock, and a tick of disagreement would
			// put an hours-wide reading in a column sized without them.
			expect(wakesAt).toBeGreaterThan(end.getTime() - MS_PER_HOUR);
			expect(wakesAt).toBeLessThanOrEqual(
				end.getTime() - MS_PER_HOUR + MS_PER_SECOND,
			);
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
			// Close enough to the next block that waiting for it outright is
			// sooner than the program would look at the schedule anyway.
			vi.setSystemTime(new Date("2026-01-01T10:55:00Z"));

			const fake = createFakeBar();
			const context = await start();

			const result = await focus.draw({ ...context, bar: fake.bar });

			expect(result.nextDrawInMs).toBe(NEXT_BLOCK_START.getTime() - Date.now());
		});

		// Waiting out a long gap in one go would miss a block added ahead of the
		// one already in the file.
		it("looks again well before a distant block starts", async () => {
			const fake = createFakeBar();
			const context = await start();

			const result = await focus.draw({ ...context, bar: fake.bar });

			expect(result.nextDrawInMs).toBe(IDLE_REFRESH_MS);
			expect(result.nextDrawInMs).toBeLessThan(
				NEXT_BLOCK_START.getTime() - Date.now(),
			);
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

		// An empty schedule usually means one that has not been filled in yet, so
		// giving up here would stay given up until the tool was restarted.
		it("keeps checking rather than giving up", async () => {
			const fake = createFakeBar();
			const context = await start();

			const result = await focus.draw({ ...context, bar: fake.bar });

			expect(result.nextDrawInMs).toBe(IDLE_REFRESH_MS);
		});
	});

	describe("when the schedule changes underneath it", () => {
		it("draws a block added after it started", async () => {
			const path = scheduleFile();
			const context = await start([], path);
			const before = createFakeBar();

			await focus.draw({ ...context, bar: before.bar });

			expect(before.draws).toHaveLength(0);

			await writeFile(path, JSON.stringify(SCHEDULE), "utf8");

			const after = createFakeBar();

			await focus.draw({ ...context, bar: after.bar });

			expect(drawnName(after.draws[0]?.elements ?? [])).toContain("TEST");
		});

		it("stops drawing a block removed after it started", async () => {
			const path = scheduleFile();
			const context = await start(SCHEDULE, path);
			const before = createFakeBar();

			await focus.draw({ ...context, bar: before.bar });

			expect(before.draws).toHaveLength(1);

			await writeFile(path, JSON.stringify([]), "utf8");

			const after = createFakeBar();

			await focus.draw({ ...context, bar: after.bar });

			expect(after.draws).toHaveLength(0);
		});

		// The file is someone else's to write, so it can be mid-write or wrong
		// long after startup. That is the runner's short retry, not a crash.
		it("fails the draw when the schedule stops being readable", async () => {
			const path = scheduleFile();
			const context = await start(SCHEDULE, path);

			await writeFile(path, "{ not json", "utf8");

			const { bar } = createFakeBar();

			await expect(focus.draw({ ...context, bar })).rejects.toThrow(
				/not valid JSON/v,
			);
		});
	});
});
