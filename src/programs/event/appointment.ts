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
	// When the calendar's own alarms ask to be reminded, soonest first.
	//
	// Empty for most entries, since most carry no alarm at all. What is here is
	// the calendar answering how much warning this one is worth, which is the
	// only per-appointment answer to that question there is.
	readonly alarms: Date[];
}

// Yellow, and deliberately none of the three colours a focus block can be.
//
// Red was the other candidate and is spoken for: it is the only red this tool
// draws, so red on the bar means a program has failed and nothing else. Yellow
// is the next most alarming thing an LED matrix does well, and against blue,
// green and orange it reads as a different kind of thing rather than as a
// focus block in a phase you had not seen before.
const ALERT_COLOR = "#FFCC00FF";

export { ALERT_COLOR };
export type { Appointment };
