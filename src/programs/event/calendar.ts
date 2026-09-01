import { parseCalendar as readOccurrences } from "../../calendar/parse.ts";
import { drawableName } from "../../text.ts";
import type { Occurrence } from "../../calendar/occurrence.ts";
import type { Appointment } from "./appointment.ts";

// Turns calendar occurrences into appointments.
//
// Reading the feed itself -- recurrence, overrides, timezones, cancellation --
// belongs to `src/calendar/` and is shared with `focus`. What is left here is
// the part only this program can answer: which entries are appointments at all.
//
// Nothing here reads an occurrence's `location` or `url`. How much warning an
// appointment gets is not a question about where it is -- see `LEAD_MINUTES`.
// They stay on `Occurrence` because that type carries what the calendar said
// rather than what a program wanted.
//
// What is read instead is the entry's alarms, which are the calendar asking for
// a particular amount of warning rather than this program inferring one.

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

	return { name, start: occurrence.start, alarms: occurrence.alarms };
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

export { parseAppointments };
