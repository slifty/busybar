import { describe, expect, it } from "vitest";
import { MS_PER_MINUTE } from "../../../constants/time.ts";
import { createFocus } from "../../../test/focus.ts";
import { colorFor, covers, nextPhaseChangeAt, phaseAt } from "../focus.ts";

const START = new Date("2026-01-01T09:00:00Z");

const minutesIn = (count: number): Date =>
	new Date(START.getTime() + count * MS_PER_MINUTE);

const blockLasting = (minutes: number) =>
	createFocus({ start: START, end: minutesIn(minutes) });

describe("phaseAt", () => {
	describe("a block long enough for all three phases", () => {
		const block = blockLasting(60);

		it.each([
			[0, "rampUp"],
			[14, "rampUp"],
			[15, "settled"],
			[44, "settled"],
			[45, "windDown"],
			[59, "windDown"],
		])("is %s minutes in -> %s", (minutes, expected) => {
			expect(phaseAt(block, minutesIn(minutes))).toBe(expected);
		});
	});

	// The two fifteen-minute bands overlap on anything shorter than half an
	// hour. Wind-down wins, so a short block never reads as ramp-up once it is
	// within fifteen minutes of ending.
	describe("a block shorter than both bands combined", () => {
		const block = blockLasting(20);

		it.each([
			[0, "rampUp"],
			[4, "rampUp"],
			[5, "windDown"],
			[19, "windDown"],
		])("is %s minutes in -> %s", (minutes, expected) => {
			expect(phaseAt(block, minutesIn(minutes))).toBe(expected);
		});

		it("never reads as settled", () => {
			const phases = Array.from({ length: 20 }, (_, minute) =>
				phaseAt(block, minutesIn(minute)),
			);

			expect(phases).not.toContain("settled");
		});
	});

	describe("a block shorter than a single band", () => {
		const block = blockLasting(10);

		it("is winding down from the moment it starts", () => {
			expect(phaseAt(block, START)).toBe("windDown");
			expect(phaseAt(block, minutesIn(9))).toBe("windDown");
		});
	});
});

describe("colorFor", () => {
	it("gives each phase a distinct colour", () => {
		const colors = [
			colorFor("rampUp"),
			colorFor("settled"),
			colorFor("windDown"),
		];

		expect(new Set(colors).size).toBe(colors.length);
	});

	it("returns colours the device will accept as #RRGGBBAA", () => {
		for (const phase of ["rampUp", "settled", "windDown"] as const) {
			expect(colorFor(phase)).toMatch(/^#[0-9A-F]{8}$/v);
		}
	});
});

describe("covers", () => {
	const block = blockLasting(60);

	it("includes the instant the block starts", () => {
		expect(covers(block, START)).toBe(true);
	});

	// Half-open, so a block ending at 10:00 has let go of the screen before one
	// starting at 10:00 claims it.
	it("excludes the instant the block ends", () => {
		expect(covers(block, minutesIn(60))).toBe(false);
	});

	it("excludes instants outside the block", () => {
		expect(covers(block, minutesIn(-1))).toBe(false);
		expect(covers(block, minutesIn(61))).toBe(false);
	});
});

describe("nextPhaseChangeAt", () => {
	const minutesUntilChange = (
		block: ReturnType<typeof blockLasting>,
		at: number,
	) =>
		(nextPhaseChangeAt(block, minutesIn(at)).getTime() -
			minutesIn(at).getTime()) /
		MS_PER_MINUTE;

	describe("a block long enough for all three phases", () => {
		const block = blockLasting(60);

		it.each([
			[0, 15],
			[15, 30],
			[45, 15],
		])(
			"at %s minutes in, wants the next draw in %s minutes",
			(at, expected) => {
				expect(minutesUntilChange(block, at)).toBe(expected);
			},
		);
	});

	it("falls back to the end of the block, which is always a change", () => {
		expect(minutesUntilChange(blockLasting(60), 45)).toBe(15);
	});

	// The fifteen-minute mark on a twenty-minute block is a band boundary, but
	// both sides of it are wind-down. Waking up for it would redraw the same
	// colour and restart the scroll on a long name for nothing.
	it("skips a boundary that does not change the colour", () => {
		expect(minutesUntilChange(blockLasting(20), 5)).toBe(15);
	});

	it("always points strictly forwards", () => {
		for (const length of [10, 20, 30, 45, 60, 90]) {
			const block = blockLasting(length);

			for (let minute = 0; minute < length; minute += 1) {
				const at = minutesIn(minute);

				expect(nextPhaseChangeAt(block, at).getTime()).toBeGreaterThan(
					at.getTime(),
				);
			}
		}
	});

	it("never points past the end of the block", () => {
		for (const length of [10, 20, 30, 45, 60, 90]) {
			const block = blockLasting(length);

			for (let minute = 0; minute < length; minute += 1) {
				expect(
					nextPhaseChangeAt(block, minutesIn(minute)).getTime(),
				).toBeLessThanOrEqual(block.end.getTime());
			}
		}
	});
});
