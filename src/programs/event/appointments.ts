import { readCalendarSource } from "../../calendar/source.ts";
import { parseAppointments } from "./calendar.ts";
import { CALENDARS_KEY } from "./settings.ts";
import type { Appointment } from "./appointment.ts";
import type { EventSettings } from "./settings.ts";

// Where the appointments come from: every configured calendar, pooled.
//
// Unlike `focus`, which reads one schedule and resolves it, this reads as many
// feeds as the file names and treats what comes back as one set. Nothing above
// this can tell which feed an appointment came from, and nothing needs to --
// what decides an alert is the appointment's own start and where it is, not
// which subscription it arrived on.

// Reads every configured calendar.
//
// The feeds are fetched at once rather than in turn. They are independent, and
// a run of four calendars read one after another would spend four timeouts'
// worth of a draw waiting on the slowest -- on the path of every draw, which
// is where this is.
//
// One feed failing fails the read. That is the same judgement `focus` makes
// about its single calendar and it matters more here, not less: carrying on
// with three calendars out of four means a bar that is confidently silent
// about a meeting it simply never saw, and silence is exactly what this
// program's working state looks like. Better to draw the error.
const loadAppointments = async (
	settings: EventSettings,
): Promise<Appointment[]> => {
	const { calendars, where } = settings;
	const now = new Date();

	const feeds = await Promise.all(
		calendars.map(async (source) => ({
			source,
			text: await readCalendarSource(source, where(CALENDARS_KEY)),
		})),
	);

	return feeds.flatMap(({ source, text }) =>
		parseAppointments(text, now, source),
	);
};

export { loadAppointments };
