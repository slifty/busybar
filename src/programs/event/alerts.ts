import type { Appointment } from "./appointment.ts";
import type { EventSettings } from "./settings.ts";

// One thing the bar says about an appointment: when it starts saying it, when
// it starts making a noise, and when it stops.
//
// An alert is about a trigger rather than about an appointment. A trigger is an
// instant the calendar asked to be reminded at, and an entry carrying three
// alarms is three separate interruptions -- a nudge the day before, another an
// hour out, and the one that catches you on the way. Each gets its own window,
// so an early reminder shows briefly and gives the screen back rather than
// holding it until the meeting.
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
	// The instant this alert is about, which every other time here is measured
	// from. It is also what tells two alerts on one appointment apart, so it is
	// what an acknowledgement is remembered against.
	readonly trigger: Date;
	// When the bar starts saying something.
	readonly opensAt: Date;
	// When it stops, whether or not anybody acknowledged it.
	//
	// It has to end somehow: the alert is meant to continue until it is
	// answered, and an unattended bar answers nothing.
	readonly endsAt: Date;
	// When the noise starts, and when it stops.
	//
	// The chime is bounded separately from the screen, because looking at a
	// yellow frame is a smaller thing to ask of somebody than listening to a
	// chime and most of an alert's life should be silent.
	readonly soundsFrom: Date;
	readonly chimesUntil: Date;
}

// The alert for one of an appointment's triggers.
//
// The screen brackets the chime rather than the other way round. Nothing stops
// a file asking to be chimed at further out than the alert is drawn, or after
// it comes down, and either would be a bar making a noise about something it is
// not naming -- alarming and unhelpful in the same breath. So the window on
// screen is whichever of the two is wider at each end.
const alertFor = (
	appointment: Appointment,
	trigger: Date,
	{ screen, chime }: EventSettings,
): Alert => {
	const at = trigger.getTime();

	return {
		appointment,
		trigger,
		opensAt: new Date(at - Math.max(screen.beforeMs, chime.beforeMs)),
		endsAt: new Date(at + Math.max(screen.untilMs, chime.untilMs)),
		soundsFrom: new Date(at - chime.beforeMs),
		chimesUntil: new Date(at + chime.untilMs),
	};
};

// Every alert every appointment asks for.
//
// An appointment whose calendar carries no alarm asks for nothing and gets
// nothing: there is no instant it has named to be interrupted at.
const alertsFor = (
	appointments: readonly Appointment[],
	settings: EventSettings,
): Alert[] =>
	appointments.flatMap((appointment) =>
		appointment.alarms.map((trigger) =>
			alertFor(appointment, trigger, settings),
		),
	);

// Whether this alert is the sort of thing that should be on screen at `at`.
//
// Half-open, [opensAt, endsAt): the alert is done the instant it ends, and the
// drawing is handed `endsAt` as its expiry, so the device takes it down at
// exactly the moment this stops being true.
const isShowing = ({ opensAt, endsAt }: Alert, at: Date): boolean =>
	opensAt.getTime() <= at.getTime() && at.getTime() < endsAt.getTime();

// Whether this alert should be making a noise at `at`.
const isSounding = ({ soundsFrom, chimesUntil }: Alert, at: Date): boolean =>
	soundsFrom.getTime() <= at.getTime() && at.getTime() < chimesUntil.getTime();

// The alert that should be on screen at `at`, if any.
//
// Two alerts about appointments that start at the same instant.
const SAME_APPOINTMENT = 0;

// The soonest appointment wins, whichever of its triggers is speaking. Alerts
// overlap constantly now: two appointments close together, an early reminder
// running into a later one, and an entry's own alarms overlapping each other.
// At any of those moments the nearer appointment is the thing you are about to
// miss, so that is what takes the screen.
//
// Ties are broken by whichever runs longest. Two alerts for the same
// appointment say the same thing, so which of them holds the screen is only
// visible in when the device is told to take it down -- and picking the shorter
// would take the alert off and put it straight back up. Anything still tied was
// read first, which `sort` being stable preserves.
const showingAt = (alerts: readonly Alert[], at: Date): Alert | undefined => {
	const [soonest] = alerts
		.filter((alert) => isShowing(alert, at))
		.sort((a, b) => {
			const byAppointment =
				a.appointment.start.getTime() - b.appointment.start.getTime();

			return byAppointment === SAME_APPOINTMENT
				? b.endsAt.getTime() - a.endsAt.getTime()
				: byAppointment;
		});

	return soonest;
};

// When the next alert that is not already showing would open.
//
// This is what the program waits for when it has nothing on screen, and what
// stops it sleeping through an alert that opens while another is up: a nearer
// appointment takes the screen the moment its own window opens, so that instant
// has to be a draw.
const nextOpensAt = (alerts: readonly Alert[], at: Date): Date | undefined => {
	const [soonest] = alerts
		.map(({ opensAt }) => opensAt)
		.filter((opensAt) => opensAt.getTime() > at.getTime())
		.sort((a, b) => a.getTime() - b.getTime());

	return soonest;
};

export { alertFor, alertsFor, isShowing, isSounding, nextOpensAt, showingAt };
export type { Alert };
