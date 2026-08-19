import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { FRONT_DISPLAY_HEIGHT } from "../../../constants/device.ts";
import { MS_PER_SECOND } from "../../../constants/time.ts";
import { COUNTDOWN_METRICS } from "../../../fonts.ts";
import { createFakeBar } from "../../../test/bar.ts";
import {
	BLOCK_END,
	BLOCK_START,
	WAKE_UP_LIMIT,
	createSchedules,
	frameOf,
	isCountdown,
	solidsOf,
	walkTo,
} from "../../../test/focus.ts";
import { focus } from "../index.ts";
import type { Elements, Rectangle } from "../../../test/focus.ts";

// The line under the clock: how much of the block is left, as a length rather
// than as a figure.
//
// Its own suite because almost every question about it is geometry -- where it
// sits, how wide it is, how much of it is lit -- and geometry is asserted in
// pixels against the countdown beside it, which is a different kind of test
// from the ones about what a block says.

// The one colour on the line that is a decision rather than a setting: what is
// still to come is white, the way the name is. How dim the spent end is drawn
// against it is a number to tune, so it is asserted below and never selected
// on.
const AHEAD_COLOR = "#FFFFFFFF";

const schedules = createSchedules();

afterAll(async () => {
	await schedules.forget();
});

beforeEach(() => {
	// Only the clock is faked, not the event loop -- these tests await real
	// file reads, and faking timers wholesale would stall them.
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(BLOCK_START);
});

afterEach(() => {
	vi.useRealTimers();
});

const blockUntil = (end: Date): unknown => [
	{
		name: "TEST",
		start: BLOCK_START.toISOString(),
		end: end.toISOString(),
	},
];

// Draws one block and hands back what went to the device.
const drawingOf = async (end: Date = BLOCK_END): Promise<Elements> => {
	const fake = createFakeBar();
	const context = await schedules.start(blockUntil(end));

	await focus.draw({ ...context, bar: fake.bar });

	return fake.draws[0]?.elements ?? [];
};

// Every one of these goes out on every draw, so one missing is the test
// failing rather than a case to carry through the assertions.
const required = <Value>(value: Value | undefined, what: string): Value => {
	if (value === undefined) {
		throw new Error(`nothing drew the ${what}`);
	}

	return value;
};

// The three segments, in the order they are drawn in: the whole line, the part
// still to come over the right of it, and now over the pixel where the two
// meet.
//
// Picked out by that order rather than by their colours. The order is what the
// device composites by, so it is already load-bearing -- and picking them out
// by colour would make every colour the program draws something a selector
// depends on, so turning PAST_BRIGHTNESS would take the suite out before any
// assertion about it ran. This way each colour is only ever asserted.
const segmentsOf = (
	elements: Elements,
): { past: Rectangle; ahead: Rectangle; now: Rectangle } => {
	const [past, ahead, now] = solidsOf(elements);

	return {
		past: required(past, "time behind"),
		ahead: required(ahead, "time ahead"),
		now: required(now, "now"),
	};
};

// A #RRGGBBAA colour taken apart, so one can be compared with another without
// pinning either to a literal.
const HEX = 16;
const CHANNEL_STARTS = [1, 3, 5];
const ALPHA_START = 7;

const channelsOf = (color: string): number[] =>
	CHANNEL_STARTS.map((at) => Number.parseInt(color.slice(at, at + 2), HEX));

const alphaOf = (color: string): string =>
	color.slice(ALPHA_START).toUpperCase();

const colorOf = ({ fill_colors: colors }: Rectangle): string =>
	(colors[0] ?? "").toUpperCase();

// Where the countdown's ink ends, which is two pixels short of the anchor a
// right-aligned countdown is drawn at.
const inkRightOf = (elements: Elements): number =>
	required(elements.find(isCountdown), "countdown").x -
	COUNTDOWN_METRICS.inkRight;

describe("the focus progress line", () => {
	// One row, sitting one clear row under the digits because it belongs to the
	// clock, with everything left over falling between it and the frame. It
	// must touch neither: digits resting on it would read as underlined, and
	// the frame is a solid line in the same colour as the pixel marking now.
	it("is a single row, one row under the digits", async () => {
		const elements = await drawingOf();
		const { past } = segmentsOf(elements);
		const countdown = required(elements.find(isCountdown), "countdown");
		const digitsEnd =
			countdown.y + COUNTDOWN_METRICS.inkTop + COUNTDOWN_METRICS.inkHeight;

		const above = past.y - digitsEnd;
		const below = FRONT_DISPLAY_HEIGHT - 1 - (past.y + past.height);

		expect(past.height).toBe(1);
		expect(above).toBe(1);
		expect(below).toBeGreaterThanOrEqual(above);
	});

	// The clock asks for its hours on every block, so it is one width always
	// and the line is that width exactly. Neither of them ever moves.
	it("is exactly the countdown's width, flush with it", async () => {
		const elements = await drawingOf();
		const { past } = segmentsOf(elements);
		const right = inkRightOf(elements);

		expect(past.width).toBe(COUNTDOWN_METRICS.widthWithHours);
		expect(past.x + past.width - 1).toBe(right);
	});

	// The hour mark used to narrow the clock and move the bar under it. It is
	// worth knowing that it does not any more, because the layout no longer
	// depends on anything the device decides for itself.
	it("is in the same place either side of the hour mark", async () => {
		vi.setSystemTime(new Date("2026-01-01T09:00:00Z"));

		const { past: wide } = segmentsOf(
			await drawingOf(new Date("2026-01-01T10:30:00Z")),
		);

		vi.setSystemTime(new Date("2026-01-01T09:45:00Z"));

		const { past: narrow } = segmentsOf(
			await drawingOf(new Date("2026-01-01T10:30:00Z")),
		);

		expect(narrow.x).toBe(wide.x);
		expect(narrow.width).toBe(wide.width);
	});

	// Three rectangles on one row, sent in the order they are meant to be seen
	// in: the whole line dim, the part still ahead over the right of it, and
	// now over the pixel where the two meet. Laid end to end instead, each
	// would be a length that reaches zero at one end of a block or the other.
	const PROGRESS_HEIGHT = 1;

	it("stacks all three segments on the same rows", async () => {
		const elements = await drawingOf();
		const { past, ahead, now } = segmentsOf(elements);

		for (const segment of [past, ahead, now]) {
			expect(segment.y).toBe(past.y);
			expect(segment.height).toBe(PROGRESS_HEIGHT);
			expect(segment.border_width).toBe(0);
			expect(segment.width).toBeGreaterThan(0);
		}

		expect(now.width).toBe(1);
		expect(now.x).toBe(ahead.x);
	});

	// What is lit is the time you still have. The dark end is what you have
	// spent -- dim rather than off, because it is what the lit part is a
	// proportion of -- and the one coloured pixel between them is now.
	it("dims the past, lights what is ahead, and colours now", async () => {
		const elements = await drawingOf();
		const frame = required(frameOf(elements), "frame");

		const { past, ahead, now } = segmentsOf(elements);

		expect(colorOf(ahead)).toBe(AHEAD_COLOR);
		expect(colorOf(now)).toBe(frame.border_color.toUpperCase());

		// The past is the same white turned down: every channel equal and
		// lower, with the alpha untouched, since alpha is compositing and
		// there is nothing behind an element here to composite it with.
		const spent = channelsOf(colorOf(past));
		const full = channelsOf(AHEAD_COLOR);

		expect(alphaOf(colorOf(past))).toBe(alphaOf(AHEAD_COLOR));
		expect(new Set(spent).size).toBe(1);

		for (const [index, channel] of spent.entries()) {
			expect(channel).toBeLessThan(full[index] ?? 0);
			expect(channel).toBeGreaterThan(0);
		}
	});

	it.each([
		["the whole block", BLOCK_START, 27],
		["half of it", new Date("2026-01-01T09:30:00Z"), 14],
		["a minute", new Date("2026-01-01T09:59:00Z"), 1],
	] as const)("lights the line for %s left", async (_label, at, expected) => {
		vi.setSystemTime(at);

		expect(segmentsOf(await drawingOf()).ahead.width).toBe(expected);
	});

	// A line that went dark while the clock beside it still read 0:00:20 would
	// be wrong about the one thing it is there to say.
	it("keeps a pixel lit until the block is actually over", async () => {
		vi.setSystemTime(new Date(BLOCK_END.getTime() - MS_PER_SECOND));

		expect(segmentsOf(await drawingOf()).ahead.width).toBe(1);
	});

	// Now walks the length of the line as the block runs: the lit part keeps
	// its right edge and gives ground on the left, so what is lit is always the
	// time still ahead. Draining the other way would put the ink on the part of
	// the block that is over.
	it("gives ground on the left, keeping the lit part against the right", async () => {
		vi.setSystemTime(new Date("2026-01-01T09:14:00Z"));

		const early = await drawingOf();

		vi.setSystemTime(new Date("2026-01-01T09:50:00Z"));

		const late = await drawingOf();

		const { ahead: aheadEarly, now: nowEarly } = segmentsOf(early);
		const { ahead: aheadLate, now: nowLate } = segmentsOf(late);

		expect(aheadLate.width).toBeLessThan(aheadEarly.width);
		expect(aheadLate.x).toBeGreaterThan(aheadEarly.x);
		expect(nowLate.x).toBeGreaterThan(nowEarly.x);
		expect(aheadLate.x + aheadLate.width).toBe(aheadEarly.x + aheadEarly.width);
	});

	// The program wakes on the exact instant a pixel is due to go, so the
	// arithmetic that places that instant and the arithmetic that counts the
	// pixels have to agree there to the millisecond. Dividing before
	// multiplying puts the quotient a hair above the integer at exactly those
	// instants, which reports the pixel as still lit, finds its next change
	// already behind it, and falls through to the next colour change -- leaving
	// the line frozen for as long as that takes.
	it("loses the pixel exactly when it said it would", async () => {
		// A fifty-four minute block divides into twenty-seven pixels of two
		// minutes each, so the boundaries are whole minutes and the case can be
		// read rather than calculated.
		const end = new Date("2026-01-01T09:54:00Z");

		vi.setSystemTime(new Date("2026-01-01T09:26:00Z"));

		const fake = createFakeBar();
		const context = await schedules.start(blockUntil(end));
		const result = await focus.draw({ ...context, bar: fake.bar });

		expect(segmentsOf(fake.draws[0]?.elements ?? []).ahead.width).toBe(14);
		expect(result.nextDrawInMs).toBe(2 * 60 * MS_PER_SECOND);
	});

	// The device cannot walk the line the way it can tick a countdown, so the
	// program has to come back for every pixel -- and for every pixel only,
	// rather than on a timer that would redraw a line that had not changed.
	it("gives up a pixel at a time over the block", async () => {
		const context = await schedules.start(blockUntil(BLOCK_END));
		const frames = await walkTo(context, BLOCK_END);
		const widths = frames.map(
			({ elements }) => segmentsOf(elements).ahead.width,
		);

		expect(frames.length).toBeLessThan(WAKE_UP_LIMIT);
		expect(
			widths.filter((width, index) => width !== widths[index - 1]),
		).toStrictEqual([
			27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9,
			8, 7, 6, 5, 4, 3, 2, 1,
		]);
	});
});
