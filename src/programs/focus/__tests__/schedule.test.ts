import { describe, expect, it } from "vitest";
import { MS_PER_MINUTE } from "../../../constants/time.ts";
import { createFocus } from "../../../test/focus.ts";
import { createSchedule, withoutOverlaps } from "../schedule.ts";
import type { Focus } from "../focus.ts";

const DAY_START = new Date("2026-01-01T09:00:00Z");

const minutesIn = (count: number): Date =>
	new Date(DAY_START.getTime() + count * MS_PER_MINUTE);

const block = (name: string, from: number, to: number): Focus =>
	createFocus({ name, start: minutesIn(from), end: minutesIn(to) });

const namesOf = (blocks: Focus[]): string[] => blocks.map(({ name }) => name);

describe("withoutOverlaps", () => {
	it("keeps blocks that do not overlap, in start order", () => {
		const kept = withoutOverlaps([
			block("second", 60, 90),
			block("first", 0, 30),
		]);

		expect(namesOf(kept)).toStrictEqual(["first", "second"]);
	});

	it("drops the later-starting block of an overlapping pair", () => {
		const kept = withoutOverlaps([
			block("first", 0, 60),
			block("second", 30, 90),
		]);

		expect(namesOf(kept)).toStrictEqual(["first"]);
	});

	// Ties go to whichever came first in the file. `sort` is stable, so leaving
	// equal starts untouched is what preserves that.
	it("settles blocks that start together by their order in the input", () => {
		const kept = withoutOverlaps([
			block("listed first", 0, 30),
			block("listed second", 0, 60),
		]);

		expect(namesOf(kept)).toStrictEqual(["listed first"]);
	});

	// Half-open blocks, so touching is not overlapping.
	it("keeps two blocks that touch end to start", () => {
		const kept = withoutOverlaps([
			block("morning", 0, 60),
			block("midday", 60, 120),
		]);

		expect(namesOf(kept)).toStrictEqual(["morning", "midday"]);
	});

	it("drops a block overlapping by a single minute rather than trimming it", () => {
		const kept = withoutOverlaps([
			block("first", 0, 60),
			block("second", 59, 120),
		]);

		expect(namesOf(kept)).toStrictEqual(["first"]);
	});

	it("drops a block wholly inside another", () => {
		const kept = withoutOverlaps([
			block("outer", 0, 120),
			block("inner", 30, 40),
		]);

		expect(namesOf(kept)).toStrictEqual(["outer"]);
	});

	// A dropped block is ignored outright, so it cannot go on to exclude
	// anything else. "long" loses to "short", which leaves "later" free.
	it("lets a block dropped for overlapping stop excluding others", () => {
		const kept = withoutOverlaps([
			block("short", 0, 10),
			block("long", 5, 120),
			block("later", 20, 30),
		]);

		expect(namesOf(kept)).toStrictEqual(["short", "later"]);
	});

	it("leaves the input untouched", () => {
		const blocks = [block("second", 60, 90), block("first", 0, 30)];

		withoutOverlaps(blocks);

		expect(namesOf(blocks)).toStrictEqual(["second", "first"]);
	});

	it("returns nothing for an empty schedule", () => {
		expect(withoutOverlaps([])).toStrictEqual([]);
	});

	it("never returns two blocks that overlap", () => {
		const kept = withoutOverlaps([
			block("a", 0, 60),
			block("b", 10, 20),
			block("c", 55, 70),
			block("d", 60, 120),
			block("e", 61, 65),
		]);

		for (const [index, current] of kept.entries()) {
			const { [index + 1]: next } = kept;

			if (next !== undefined) {
				expect(current.end.getTime()).toBeLessThanOrEqual(next.start.getTime());
			}
		}
	});
});

describe("createSchedule", () => {
	const schedule = createSchedule([
		block("morning", 0, 60),
		block("ignored", 30, 45),
		block("afternoon", 120, 180),
	]);

	describe("activeAt", () => {
		it("finds the block covering an instant", () => {
			expect(schedule.activeAt(minutesIn(30))?.name).toBe("morning");
		});

		it("finds nothing in the gap between blocks", () => {
			expect(schedule.activeAt(minutesIn(90))).toBeUndefined();
		});

		it("finds nothing before the first block or after the last", () => {
			expect(schedule.activeAt(minutesIn(-1))).toBeUndefined();
			expect(schedule.activeAt(minutesIn(200))).toBeUndefined();
		});

		it("never returns a block that lost an overlap", () => {
			const active = Array.from({ length: 200 }, (_, minute) =>
				schedule.activeAt(minutesIn(minute)),
			);

			expect(active.map((found) => found?.name)).not.toContain("ignored");
		});
	});

	describe("nextAfter", () => {
		it("finds the next block from within one", () => {
			expect(schedule.nextAfter(minutesIn(30))?.name).toBe("afternoon");
		});

		it("finds the next block from a gap", () => {
			expect(schedule.nextAfter(minutesIn(90))?.name).toBe("afternoon");
		});

		it("finds the first block from before the schedule starts", () => {
			expect(schedule.nextAfter(minutesIn(-1))?.name).toBe("morning");
		});

		it("finds nothing once the schedule is spent", () => {
			expect(schedule.nextAfter(minutesIn(200))).toBeUndefined();
		});
	});
});
