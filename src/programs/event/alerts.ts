import { alertOpensAt, isAlerting } from "./appointment.ts";
import type { Appointment } from "./appointment.ts";

// Which appointment the bar is speaking about, and when it next has to think
// again.
//
// Appointments are not resolved against each other the way focus blocks are.
// Two blocks cannot both be what you are doing, so `focus` discards one of any
// overlapping pair outright; two appointments can perfectly well both be
// coming up, and neither is wrong. What has to be decided is only which of
// them owns 72x16 pixels at this instant.

// The appointment whose alert should be on screen at `at`, if any.
//
// The soonest start wins. Alerts overlap whenever a distant appointment with a
// long lead runs into a near one with a short lead -- a two o'clock across town
// starts warning at half past one, and a half past one call starts warning at
// twenty-five past -- and at that moment the call is the thing you are about to
// miss. Sorting by start rather than by how long the alert has been up is what
// makes the more urgent of the two win, whichever spoke first.
//
// Ties go to whichever was read first, which `sort` being stable is what
// preserves. Two appointments starting at the same instant are a coin toss the
// calendar has already made.
const alertAt = (
	appointments: readonly Appointment[],
	at: Date,
): Appointment | undefined => {
	const [soonest] = appointments
		.filter((appointment) => isAlerting(appointment, at))
		.sort((a, b) => a.start.getTime() - b.start.getTime());

	return soonest;
};

// When the next alert that is not already showing would open.
//
// This is what the program waits for when it has nothing on screen, and what
// stops it sleeping through an alert that opens while a longer one is up: an
// appointment starting sooner than the one currently showing takes the screen
// the moment its own window opens, so that instant has to be a draw.
const nextAlertOpensAt = (
	appointments: readonly Appointment[],
	at: Date,
): Date | undefined => {
	const [soonest] = appointments
		.map((appointment) => alertOpensAt(appointment))
		.filter((opens) => opens.getTime() > at.getTime())
		.sort((a, b) => a.getTime() - b.getTime());

	return soonest;
};

export { alertAt, nextAlertOpensAt };
