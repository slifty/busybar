import { parseCalendar as readOccurrences } from "../../calendar/parse.ts";
import { drawableName } from "../../text.ts";
import type { Occurrence } from "../../calendar/occurrence.ts";
import type { Appointment, Kind } from "./appointment.ts";

// Turns calendar occurrences into appointments.
//
// Reading the feed itself -- recurrence, overrides, timezones, cancellation --
// belongs to `src/calendar/` and is shared with `focus`. What is left here is
// the part only this program can answer: which entries are appointments, and
// how you are expected to attend each one.

// A Windows drive letter is one character. Every real URI scheme is longer,
// which is what lets the two be told apart below.
const DRIVE_LETTER_LENGTH = 1;

// `protocol` carries its trailing colon, which is not part of the scheme.
const COLON = 1;

// Whether the calendar wrote a link where it was asked for a place.
//
// Any scheme counts, not only http. A Zoom deep link (`zoommtg:`), a Teams one
// (`msteams:`) and a dial-in (`tel:`) are all things you join from wherever
// you are sitting, and reading them as somewhere to travel to would give a
// desk call half an hour of warning it has no use for.
//
// A one-character scheme is not a link, which keeps a Windows path -- the only
// thing that produces one -- a place. The guard is worth its two lines because
// the two ways of being wrong are not equally bad: a link read as a place
// over-warns by twenty-five minutes, which is a mild annoyance, while a place
// read as a link under-warns by the same, which is how you arrive late. So
// where this is unsure it stays on the side of warning too early.
const isLink = (location: string): boolean => {
	if (!URL.canParse(location)) {
		return false;
	}

	const { protocol } = new URL(location);

	return protocol.length - COLON > DRIVE_LETTER_LENGTH;
};

// How the appointment is attended, which is the whole of what decides how much
// warning it gets.
//
// A physical location wins over a link when an entry carries both, which is
// ordinary for a meeting that is in a room and also dialled into. Travel is
// the binding constraint: warned thirty minutes out you can still take the
// call from your desk, whereas warned five minutes out you cannot be in the
// room. The failure of guessing wrong is asymmetric, so the guess goes to the
// one that costs less.
//
// A location that is itself a link is not a place. Calendars routinely put a
// video call URL in the LOCATION field, and reading that as somewhere to
// travel to would give every call at your desk half an hour of warning.
const kindOf = ({ location, url }: Occurrence): Kind => {
	if (location !== undefined && !isLink(location)) {
		return "located";
	}

	// Past the check above, a location that is set is a link.
	if (url !== undefined || location !== undefined) {
		return "url";
	}

	return "plain";
};

// One occurrence, as an appointment -- or nothing, when the calendar says
// something this program has no use for.
//
// Two kinds of entry are dropped, quietly, because a calendar is not written
// for this tool and one odd entry in it should not take the rest down:
//
//   - All-day events. They begin on a date rather than at a time, so there is
//     no instant to be on time for. An all-day entry is a label for the day
//     rather than something you can be late to.
//   - Entries whose title has nothing the display can render. The name is the
//     whole of what the alert says, and an alert that names nothing is a
//     yellow box interrupting you for reasons it declines to give.
//
// What is deliberately *not* dropped is an entry that ends no later than it
// starts. `focus` discards those, correctly -- there is nothing to count down.
// Here it is an ordinary appointment: a calendar is entitled to say that
// something happens at two o'clock without saying when it stops, and being on
// time for it is exactly what this program is for.
const appointmentFrom = (occurrence: Occurrence): Appointment | undefined => {
	if (occurrence.allDay) {
		return undefined;
	}

	const name = drawableName(occurrence.summary);

	if (name === "") {
		return undefined;
	}

	return { name, start: occurrence.start, kind: kindOf(occurrence) };
};

// Reads an iCalendar feed into the appointments that fall near `now`.
const parseAppointments = (
	text: string,
	now: Date,
	source: string,
): Appointment[] =>
	readOccurrences(text, now, source).flatMap((occurrence) => {
		const appointment = appointmentFrom(occurrence);

		return appointment === undefined ? [] : [appointment];
	});

export { kindOf, parseAppointments };
