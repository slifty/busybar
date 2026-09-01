import { describe, expect, it } from "vitest";
import { parseAppointments } from "../calendar.ts";
import {
	ABSOLUTE_ALARM_EVENT,
	ALARMED_EVENT,
	ALL_DAY_EVENT,
	CANCELLED_EVENT,
	EMAILED_ALARM_EVENT,
	END_RELATED_ALARM_EVENT,
	ENDLESS_EVENT,
	INSTANT_EVENT,
	LATE_ABSOLUTE_ALARM_EVENT,
	LATE_ALARM_EVENT,
	LATE_END_RELATED_ALARM_EVENT,
	LOCATED_EVENT,
	PLACELESS_EVENT,
	RECURRING_ALARM_EVENT,
	SUPPRESSED_ALARM_EVENT,
	TWICE_ALARMED_EVENT,
	UNDRAWABLE_TITLE_EVENT,
	VERBOSE_ALARM_EVENT,
} from "./fixtures/calendars.ts";
import type { Appointment } from "../appointment.ts";

// Midnight, so the window either side of it lands on whole days and the
// fixtures can be read at a glance.
const NOW = new Date("2026-01-02T00:00:00Z");

const SOURCE = "test.ics";

const read = (text: string): Appointment[] =>
	parseAppointments(text, NOW, SOURCE);

const only = (text: string): Appointment => {
	const [appointment] = read(text);

	if (appointment === undefined) {
		throw new Error("expected one appointment, got none");
	}

	return appointment;
};

describe("parseAppointments", () => {
	// Nothing is read off LOCATION or URL: the same appointment with and
	// without a place is the same appointment.
	describe("where the calendar says it is", () => {
		it("makes no difference to what is read", () => {
			expect(only(LOCATED_EVENT)).toStrictEqual(only(PLACELESS_EVENT));
		});

		it("leaves an appointment carrying no trace of it", () => {
			expect(only(LOCATED_EVENT)).toStrictEqual({
				name: "TEST Located",
				start: new Date("2026-01-02T09:00:00Z"),
				alarms: [],
			});
		});
	});

	// A VALARM is the calendar answering "how much warning is this worth?" for
	// itself, which is the one per-entry answer to that question there is.
	describe("the alarms the calendar carries", () => {
		const alarmsOf = (text: string): string[] =>
			only(text).alarms.map((alarm) => alarm.toISOString());

		it("reads an offset as the instant it lands on", () => {
			expect(alarmsOf(ALARMED_EVENT)).toStrictEqual([
				"2026-01-02T08:50:00.000Z",
			]);
		});

		// Both spellings are written by real calendars, and Google writes the
		// long one.
		it("reads the long spelling of an offset as the same instant", () => {
			expect(alarmsOf(VERBOSE_ALARM_EVENT)).toStrictEqual([
				"2026-01-02T08:55:00.000Z",
			]);
		});

		it("reads a fixed instant as itself", () => {
			expect(alarmsOf(ABSOLUTE_ALARM_EVENT)).toStrictEqual([
				"2026-01-02T07:00:00.000Z",
			]);
		});

		// Legal and rare: a reminder about a thing finishing.
		it("measures from the end when the trigger says to", () => {
			expect(alarmsOf(END_RELATED_ALARM_EVENT)).toStrictEqual([
				"2026-01-02T08:30:00.000Z",
			]);
		});

		it("keeps every alarm, soonest first", () => {
			expect(alarmsOf(TWICE_ALARMED_EVENT)).toStrictEqual([
				"2026-01-02T08:55:00.000Z",
				"2026-01-02T09:00:00.000Z",
			]);
		});

		// The offset has to land on the occurrence's own day. Reading it
		// against the series' first would put every reminder on the second of
		// January.
		it("lands a recurring entry's alarm on each occurrence", () => {
			expect(
				parseAppointments(RECURRING_ALARM_EVENT, NOW, SOURCE).map(
					({ alarms }) => alarms.map((alarm) => alarm.toISOString()),
				),
			).toStrictEqual([
				["2026-01-02T08:50:00.000Z"],
				["2026-01-03T08:50:00.000Z"],
			]);
		});

		describe("what is ignored", () => {
			// A suppression rather than a request: it says "do not apply your
			// default alarm", and the absurd instant is the tell.
			it("ignores an alarm asking for no action", () => {
				expect(alarmsOf(SUPPRESSED_ALARM_EVENT)).toStrictEqual([]);
			});

			// It asks for a message to be sent, and whoever it is sent to is
			// not necessarily whoever is in front of the bar.
			it("ignores an alarm asking for an email", () => {
				expect(alarmsOf(EMAILED_ALARM_EVENT)).toStrictEqual([]);
			});

			// An appointment is about its start, so an alarm landing after that
			// has nothing left to warn anybody about -- and there are three
			// ways to land late, which is why the question is asked of the
			// instant rather than of the offset that produced it.
			it.each([
				["an offset that is simply positive", LATE_ALARM_EVENT],
				[
					"an offset from an end the event outruns",
					LATE_END_RELATED_ALARM_EVENT,
				],
				["a fixed instant", LATE_ABSOLUTE_ALARM_EVENT],
			])(
				"ignores a trigger landing after the start, from %s",
				(_label, feed) => {
					expect(alarmsOf(feed)).toStrictEqual([]);
				},
			);
		});
	});

	// The rule `focus` gets right for itself and wrong for this program. An
	// entry with no duration is nothing to count down and an ordinary thing to
	// be on time for.
	describe("entries with no duration", () => {
		it("keeps one whose end is its start", () => {
			expect(only(INSTANT_EVENT).name).toBe("TEST Instant");
		});

		it("keeps one with no end written at all", () => {
			expect(only(ENDLESS_EVENT).name).toBe("TEST Endless");
		});

		it("takes the start as the moment to be on time for", () => {
			expect(only(INSTANT_EVENT).start.toISOString()).toBe(
				"2026-01-02T09:00:00.000Z",
			);
		});
	});

	describe("what is dropped", () => {
		// No instant to be on time for: it is a label for the day.
		it("drops an all-day entry", () => {
			expect(read(ALL_DAY_EVENT)).toStrictEqual([]);
		});

		// The name is the whole of what the alert says.
		it("drops a title with nothing the display can render", () => {
			expect(read(UNDRAWABLE_TITLE_EVENT)).toStrictEqual([]);
		});

		it("drops what the calendar itself has cancelled", () => {
			expect(read(CANCELLED_EVENT)).toStrictEqual([]);
		});
	});

	it("reduces a name to what the fonts can draw", () => {
		expect(only(LOCATED_EVENT).name).toBe("TEST Located");
	});
});
