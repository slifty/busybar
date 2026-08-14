import { MS_PER_MINUTE } from "../../constants/time.ts";

// Something you have to be somewhere for.
//
// Unlike a focus block, an appointment's duration is not what the bar is for.
// A block is about the whole span -- what you should be thinking about now, and
// how much of it is left -- whereas an appointment is about one instant, its
// start, and being ready when it arrives. So nothing here carries an end: a
// calendar entry with no duration at all is a perfectly good "be somewhere at
// two", and once the thing has started the bar has nothing left to say about
// it.
interface Appointment {
	readonly name: string;
	readonly start: Date;
	readonly kind: Kind;
}

// How much warning an appointment is worth, by how you get to it.
//
// The numbers are the whole of the program's judgement, and they are about
// travel rather than importance: what differs between these is how long it
// takes to be where the appointment is, not how much the appointment matters.
const LEAD_MINUTES = {
	// A link takes as long as it takes to open, so five minutes is enough to
	// finish a sentence and click it.
	url: 5,
	// Somewhere to physically be. Thirty minutes is the warning that has to
	// cover getting there, and is the reason this distinction exists at all.
	located: 30,
	// A calendar that says neither. Treated as a link rather than as a place,
	// because an entry with nowhere written on it is far more often something
	// at your desk than something across town -- and being warned five minutes
	// out for a journey is a worse failure than being warned thirty minutes
	// out for a call, but guessing "place" would do the first to every
	// unlabelled entry in the calendar.
	//
	// It shares a number with `url` today and is kept apart from it anyway.
	// The issue this program came from separates the two, and the version that
	// gains sound and a button to acknowledge it will need them separated: the
	// thirty-second alert is for everything with no physical location, which
	// is these two kinds and not the third.
	plain: 5,
} as const;

type Kind = keyof typeof LEAD_MINUTES;

// Yellow, and deliberately none of the three colours a focus block can be.
//
// Red was the other candidate and is spoken for: it is the only red this tool
// draws, so red on the bar means a program has failed and nothing else. Yellow
// is the next most alarming thing an LED matrix does well, and against blue,
// green and orange it reads as a different kind of thing rather than as a
// focus block in a phase you had not seen before.
const ALERT_COLOR = "#FFCC00FF";

const leadMsFor = (kind: Kind): number => LEAD_MINUTES[kind] * MS_PER_MINUTE;

// When the bar should start saying something about this appointment.
const alertOpensAt = ({ kind, start }: Appointment): Date =>
	new Date(start.getTime() - leadMsFor(kind));

// Whether the alert for this appointment is the one that should be on screen.
//
// Half-open, [opens, start): the alert is done the instant the appointment
// begins. Its whole job is getting you there on time, which is over once it is
// time -- and the drawing is handed the start as its expiry, so the device
// takes it down at exactly the moment this stops being true.
const isAlerting = (appointment: Appointment, at: Date): boolean =>
	alertOpensAt(appointment).getTime() <= at.getTime() &&
	at.getTime() < appointment.start.getTime();

export { ALERT_COLOR, LEAD_MINUTES, alertOpensAt, isAlerting, leadMsFor };
export type { Appointment, Kind };
