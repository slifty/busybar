import { describe, expect, it } from "vitest";
import { parseAppointments } from "../calendar.ts";
import {
	ALL_DAY_EVENT,
	APP_LINK_IN_LOCATION_EVENT,
	BLANK_LOCATION_EVENT,
	CANCELLED_EVENT,
	COLON_IN_ROOM_NAME_EVENT,
	DRIVE_LETTER_LOCATION_EVENT,
	ENDLESS_EVENT,
	GOOGLE_CONFERENCE_EVENT,
	INSTANT_EVENT,
	LOCATED_AND_LINKED_EVENT,
	LOCATED_EVENT,
	PLAIN_EVENT,
	TEL_IN_LOCATION_EVENT,
	UNDRAWABLE_TITLE_EVENT,
	URL_EVENT,
	URL_IN_LOCATION_EVENT,
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
	describe("how the appointment is attended", () => {
		it("is located when the calendar names a place", () => {
			expect(only(LOCATED_EVENT).kind).toBe("located");
		});

		it("is url when the calendar carries a URL property", () => {
			expect(only(URL_EVENT).kind).toBe("url");
		});

		// The property Google actually writes, and the one most feeds carry.
		it("is url when the link is a Google conference", () => {
			expect(only(GOOGLE_CONFERENCE_EVENT).kind).toBe("url");
		});

		// Otherwise every call taken at a desk would claim half an hour of
		// warning it does not need.
		it("is url when the place is itself a link", () => {
			expect(only(URL_IN_LOCATION_EVENT).kind).toBe("url");
		});

		// Not only http. A calendar writes a deep link when the meeting is
		// joined through an app rather than a browser, and it is still
		// something you join from wherever you are sitting.
		it.each([
			["an app deep link", APP_LINK_IN_LOCATION_EVENT],
			["a dial-in number", TEL_IN_LOCATION_EVENT],
		])("is url when the place is %s", (_label, feed) => {
			expect(only(feed).kind).toBe("url");
		});

		// The reason the check is not simply "does it parse as a URL". A path
		// does, with a one-character scheme, and it is a place -- and reading a
		// place as a link is the expensive direction, since it under-warns.
		it("is located when the place is a path with a drive letter", () => {
			expect(only(DRIVE_LETTER_LOCATION_EVENT).kind).toBe("located");
		});

		// A colon in a room name does not make it a URL: the text before it has
		// a space, so it cannot be a scheme.
		it("is located when the room name merely contains a colon", () => {
			expect(only(COLON_IN_ROOM_NAME_EVENT).kind).toBe("located");
		});

		// Travel is the binding constraint: warned thirty minutes out you can
		// still take the call, warned five you cannot reach the room.
		it("is located when there is both a room and a link", () => {
			expect(only(LOCATED_AND_LINKED_EVENT).kind).toBe("located");
		});

		it("is plain when the calendar says neither", () => {
			expect(only(PLAIN_EVENT).kind).toBe("plain");
		});

		// A property written with nothing after it says no more than one left
		// out entirely.
		it("is plain when the place was written blank", () => {
			expect(only(BLANK_LOCATION_EVENT).kind).toBe("plain");
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
