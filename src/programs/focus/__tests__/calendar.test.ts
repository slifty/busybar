import { describe, expect, it } from "vitest";
import { HORIZON_HOURS, LOOKBACK_HOURS, parseCalendar } from "../calendar.ts";
import {
	ALL_DAY_EVENT,
	AWKWARD_TITLES,
	BACKWARDS_EVENT,
	CANCELLED_EVENT,
	DISTANT_EVENT,
	EXHAUSTED_SERIES,
	NOT_A_CALENDAR,
	ORPHANED_OVERRIDE,
	RECURRING_SERIES,
	SERIES_WITH_CANCELLED_OCCURRENCE,
	SINGLE_EVENT,
	STRADDLING_EVENT,
	ZONED_EVENT,
} from "./fixtures/calendars.ts";

// Midnight, so the window either side of it lands on whole days and the
// fixtures can be read at a glance.
const NOW = new Date("2026-01-02T00:00:00Z");

const SOURCE = "test.ics";

const read = (text: string): ReturnType<typeof parseCalendar> =>
	parseCalendar(text, NOW, SOURCE);

// What the rest of the program will actually compare against.
const times = (text: string): string[] =>
	read(text).map(
		({ name, start, end }) =>
			`${name} ${start.toISOString()} ${end.toISOString()}`,
	);

describe("parseCalendar", () => {
	it("reads a timed event as a block", () => {
		expect(times(SINGLE_EVENT)).toStrictEqual([
			"Deep Work 2026-01-02T09:00:00.000Z 2026-01-02T10:30:00.000Z",
		]);
	});

	describe("the window it reads", () => {
		// The block most likely to be on screen is one that started before now,
		// so the window is about overlap rather than about start times.
		it("keeps a block already running when the window opens", () => {
			expect(times(STRADDLING_EVENT)).toStrictEqual([
				"Overnight 2025-12-31T23:00:00.000Z 2026-01-01T01:00:00.000Z",
			]);
		});

		it("leaves out a block beyond the horizon", () => {
			expect(read(DISTANT_EVENT)).toStrictEqual([]);
		});

		it("reaches further forward than back", () => {
			expect(HORIZON_HOURS).toBeGreaterThan(LOOKBACK_HOURS);
		});
	});

	describe("a recurring series", () => {
		it("expands into one block per occurrence in the window", () => {
			expect(times(RECURRING_SERIES)).toHaveLength(2);
		});

		// The two ways a calendar records an edit to a single occurrence: drop
		// it, or supersede it with a VEVENT carrying a RECURRENCE-ID.
		it("leaves out an excluded occurrence", () => {
			expect(times(RECURRING_SERIES).join("\n")).not.toContain("2026-01-03");
		});

		it("takes the moved time and new title of an overridden occurrence", () => {
			expect(times(RECURRING_SERIES)).toContain(
				"Standup (moved) 2026-01-02T14:00:00.000Z 2026-01-02T14:30:00.000Z",
			);
		});

		it("keeps the occurrences the series did not change", () => {
			expect(times(RECURRING_SERIES)).toContain(
				"Standup 2026-01-01T09:00:00.000Z 2026-01-01T09:30:00.000Z",
			);
		});

		// The expansion is typed as always returning a time and does not: it
		// yields nothing once a series runs out. A series that ends inside the
		// window is the only way to reach that, and reaching it used to throw.
		it("stops at the end of a series that runs out before the window does", () => {
			expect(times(EXHAUSTED_SERIES)).toStrictEqual([
				"Short Series 2026-01-01T09:00:00.000Z 2026-01-01T09:30:00.000Z",
				"Short Series 2026-01-02T09:00:00.000Z 2026-01-02T09:30:00.000Z",
			]);
		});

		// Called off rather than moved: the whole series is not cancelled, only
		// the one occurrence whose override says so.
		it("leaves out an occurrence cancelled on its own", () => {
			expect(times(SERIES_WITH_CANCELLED_OCCURRENCE)).toStrictEqual([
				"Mostly On 2026-01-01T09:00:00.000Z 2026-01-01T09:30:00.000Z",
				"Mostly On 2026-01-03T09:00:00.000Z 2026-01-03T09:30:00.000Z",
			]);
		});

		// A feed trimmed to a date range produces these readily: the override
		// survived the trim and the series it belongs to did not. It is still a
		// real block someone put in their calendar.
		it("keeps an override whose series is not in the feed", () => {
			expect(times(ORPHANED_OVERRIDE)).toStrictEqual([
				"Orphaned Override 2026-01-02T10:00:00.000Z 2026-01-02T11:00:00.000Z",
			]);
		});
	});

	// Without the calendar's own VTIMEZONE, a named zone resolves as if it were
	// UTC -- a block drawn five hours out, rather than an error anyone notices.
	it("resolves a named timezone against the calendar's own definition", () => {
		expect(times(ZONED_EVENT)).toStrictEqual([
			"Eastern Morning 2026-01-02T14:00:00.000Z 2026-01-02T15:00:00.000Z",
		]);
	});

	describe("what it declines to draw", () => {
		// An all-day event runs midnight to midnight, and an overlapping block is
		// discarded in favour of whichever starts earlier -- so one of these left
		// in would suppress every real block of that day.
		it("skips an all-day event", () => {
			expect(read(ALL_DAY_EVENT)).toStrictEqual([]);
		});

		it("skips an event the calendar has cancelled", () => {
			expect(read(CANCELLED_EVENT)).toStrictEqual([]);
		});

		it("skips an event that ends before it starts", () => {
			expect(read(BACKWARDS_EVENT)).toStrictEqual([]);
		});

		// One unreadable title is not a reason to take the whole schedule down,
		// which is the difference between a calendar and a file you wrote.
		it("skips an event whose title has nothing drawable, keeping the rest", () => {
			expect(times(AWKWARD_TITLES)).toStrictEqual([
				"Focus: Q3 Roadmap 2026-01-02T09:00:00.000Z 2026-01-02T10:00:00.000Z",
			]);
		});
	});

	describe("when the feed is not what it should be", () => {
		it("says so when the text is not iCalendar at all", () => {
			expect(() => read("this is not a calendar")).toThrow(
				/test\.ics is not a valid iCalendar feed/v,
			);
		});

		// Most often a sign-in page or an error document served with a 200,
		// which is worth saying plainly rather than reporting as an empty day.
		it("says so when the document is not a calendar", () => {
			expect(() => read(NOT_A_CALENDAR)).toThrow(/is not a calendar/v);
		});
	});
});
