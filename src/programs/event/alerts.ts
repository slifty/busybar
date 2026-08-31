import type { Appointment } from "./appointment.ts";
import type { EventSettings } from "./settings.ts";

// An appointment as the bar will actually speak about it: when it starts
// saying so, when it starts making a noise, and when it stops.
//
// The instants are worked out once, here, rather than recomputed from the
// settings wherever they are wanted. Two things fall out of that. Everything
// downstream -- which alert owns the screen, when to think again, whether to
// play a sound -- compares dates and needs no settings at all. And the whole
// of the policy is in one function, so "when does this appointment start
// shouting, and when does it stop?" has one answer rather than four agreeing
// ones.
//
// Appointments are not resolved against each other the way focus blocks are.
// Two blocks cannot both be what you are doing, so `focus` discards one of any
// overlapping pair outright; two appointments can perfectly well both be
// coming up, and neither is wrong. What has to be decided is only which of
// them owns 72x16 pixels at this instant.
interface Alert {
	readonly appointment: Appointment;
	// When the bar starts saying something about this appointment.
	readonly opensAt: Date;
	// When it stops, whether or not anybody acknowledged it.
	//
	// Later than the appointment's own start: the noise is supposed to continue
	// until it is acknowledged, and something has to end it when nothing does.
	// The screen going quiet while the bar was still shouting would be the bar
	// contradicting itself.
	readonly endsAt: Date;
	// When the noise starts.
	readonly soundsFrom: Date;
}

// The alert for one appointment, given what the file says about warnings.
const alertFor = (
	appointment: Appointment,
	{ leadMs, sound }: EventSettings,
): Alert => {
	const start = appointment.start.getTime();
	const soundsFrom = new Date(start - sound.leadMs);

	// The alert is on screen by the time it makes a noise, whatever the file
	// says. Nothing stops `lead` being set shorter than `sound.lead`, and a bar
	// chiming about an appointment it is not naming is a bar being alarming and
	// unhelpful in the same breath.
	const warnsFrom = new Date(start - leadMs);
	const opensAt =
		soundsFrom.getTime() < warnsFrom.getTime() ? soundsFrom : warnsFrom;

	return {
		appointment,
		opensAt,
		endsAt: new Date(start + sound.lingerMs),
		soundsFrom,
	};
};

const alertsFor = (
	appointments: readonly Appointment[],
	settings: EventSettings,
): Alert[] =>
	appointments.map((appointment) => alertFor(appointment, settings));

// Whether this alert is the sort of thing that should be on screen at `at`.
//
// Half-open, [opensAt, endsAt): the alert is done the instant it ends, and the
// drawing is handed `endsAt` as its expiry, so the device takes it down at
// exactly the moment this stops being true.
const isShowing = ({ opensAt, endsAt }: Alert, at: Date): boolean =>
	opensAt.getTime() <= at.getTime() && at.getTime() < endsAt.getTime();

// Whether this alert should be making a noise at `at`.
const isSounding = ({ soundsFrom, endsAt }: Alert, at: Date): boolean =>
	soundsFrom.getTime() <= at.getTime() && at.getTime() < endsAt.getTime();

// The alert that should be on screen at `at`, if any.
//
// The soonest start wins. Alerts overlap whenever two appointments are closer
// together than the lead, and whenever one is still chiming past its own start
// as the next one opens -- a two o'clock and a five past two overlap for the
// whole of the first alert's linger, and at that moment the two o'clock is the
// thing you are about to miss. Sorting by start rather than by how long the
// alert has been up is what makes the more urgent of the two win, whichever
// spoke first.
//
// Ties go to whichever was read first, which `sort` being stable is what
// preserves. Two appointments starting at the same instant are a coin toss the
// calendar has already made.
const showingAt = (alerts: readonly Alert[], at: Date): Alert | undefined => {
	const [soonest] = alerts
		.filter((alert) => isShowing(alert, at))
		.sort(
			(a, b) => a.appointment.start.getTime() - b.appointment.start.getTime(),
		);

	return soonest;
};

// When the next alert that is not already showing would open.
//
// This is what the program waits for when it has nothing on screen, and what
// stops it sleeping through an alert that opens while a longer one is up: an
// appointment starting sooner than the one currently showing takes the screen
// the moment its own window opens, so that instant has to be a draw.
const nextOpensAt = (alerts: readonly Alert[], at: Date): Date | undefined => {
	const [soonest] = alerts
		.map(({ opensAt }) => opensAt)
		.filter((opensAt) => opensAt.getTime() > at.getTime())
		.sort((a, b) => a.getTime() - b.getTime());

	return soonest;
};

export { alertFor, alertsFor, isShowing, isSounding, nextOpensAt, showingAt };
export type { Alert };
