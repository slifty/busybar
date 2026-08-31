import { describe, expect, it } from "vitest";
import { parseAppointments } from "../calendar.ts";
import {
	ALL_DAY_EVENT,
	CANCELLED_EVENT,
	ENDLESS_EVENT,
	INSTANT_EVENT,
	LOCATED_EVENT,
	PLACELESS_EVENT,
	UNDRAWABLE_TITLE_EVENT,
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

		it("leaves an appointment with nothing on it but a name and a start", () => {
			expect(only(LOCATED_EVENT)).toStrictEqual({
				name: "TEST Located",
				start: new Date("2026-01-02T09:00:00Z"),
			});
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
