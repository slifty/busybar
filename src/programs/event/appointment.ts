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

// How much warning an appointment is worth, by how you get to it, in minutes.
//
// These are defaults rather than the rule -- `leads` in the config file is what
// actually decides -- but they are the answer for anyone who never writes that
// block, so the reasoning belongs with the numbers.
//
// The reasoning is about travel rather than importance: what differs between
// these is how long it takes to be where the appointment is, not how much the
// appointment matters.
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
	// It shares a number with `url` and is kept apart from it anyway. They are
	// two different statements -- one is a calendar saying "join this here",
	// the other is a calendar saying nothing at all -- and the file can give
	// them different numbers even though the defaults agree.
	plain: 5,
} as const;

type Kind = keyof typeof LEAD_MINUTES;

// Whether the calendar named somewhere to physically be.
//
// This is the whole of what decides which alerts make a noise. The issue this
// program comes from asks for sound on everything *without* a physical
// location, and the reasoning is that those are the ones you can be late to
// while sitting still: a meeting across town is missed half an hour before it
// starts, and no chime thirty seconds out was ever going to save it, whereas a
// call you are meant to be on is missed by exactly the thirty seconds you spent
// not noticing.
const hasPlace = ({ kind }: Appointment): boolean => kind === "located";

// Whether this appointment's alert makes a noise.
const sounds = (appointment: Appointment): boolean => !hasPlace(appointment);

// Yellow, and deliberately none of the three colours a focus block can be.
//
// Red was the other candidate and is spoken for: it is the only red this tool
// draws, so red on the bar means a program has failed and nothing else. Yellow
// is the next most alarming thing an LED matrix does well, and against blue,
// green and orange it reads as a different kind of thing rather than as a
// focus block in a phase you had not seen before.
const ALERT_COLOR = "#FFCC00FF";

export { ALERT_COLOR, LEAD_MINUTES, hasPlace, sounds };
export type { Appointment, Kind };
