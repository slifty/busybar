import { sounds } from "./appointment.ts";
import type { Appointment } from "./appointment.ts";
import type { EventSettings } from "./settings.ts";

// An appointment as the bar will actually speak about it: when it starts
// saying so, when it stops, and whether it makes a noise while it does.
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
	// For an alert with somewhere to be, this is the appointment's own start:
	// getting you there on time is the entire job, and it is over once it is
	// time. For one that makes a noise it is later, because the noise is
	// supposed to continue until it is acknowledged and something has to end
	// it when nothing does.
	readonly endsAt: Date;
	// When the noise starts, or undefined for an alert that stays silent.
	readonly soundsFrom: Date | undefined;
}

// The alert for one appointment, given what the file says about warnings.
const alertFor = (
	appointment: Appointment,
	{ leads, sound }: EventSettings,
): Alert => {
	const start = appointment.start.getTime();
	const soundsFrom = sounds(appointment)
		? new Date(start - sound.leadMs)
		: undefined;

	// The alert is on screen by the time it makes a noise, whatever the leads
	// say. Nothing stops a file setting `leads.url` shorter than `sound.lead`,
	// and a bar chiming about an appointment it is not naming is a bar being
	// alarming and unhelpful in the same breath.
	const warnsFrom = new Date(start - leads[appointment.kind]);
	const opensAt =
		soundsFrom !== undefined && soundsFrom.getTime() < warnsFrom.getTime()
			? soundsFrom
			: warnsFrom;

	return {
		appointment,
		opensAt,
		endsAt:
			soundsFrom === undefined
				? appointment.start
				: new Date(start + sound.lingerMs),
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
const isSounding = (alert: Alert, at: Date): boolean =>
	alert.soundsFrom !== undefined &&
	alert.soundsFrom.getTime() <= at.getTime() &&
	at.getTime() < alert.endsAt.getTime();

// The alert that should be on screen at `at`, if any.
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
