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
}

// How much warning an appointment gets, in minutes.
//
// The same for every one. Nothing a calendar entry carries says reliably how
// long it takes to get there: `LOCATION` is prose, and reading it as an
// instruction misjudges a desk call as often as it catches a journey.
//
// Five minutes is long enough to finish a sentence and click a link, and
// deliberately not long enough to cross town. An appointment that needs more
// has to say so itself, which is what reading `VALARM` triggers is for.
const LEAD_MINUTES = 5;

// Yellow, and deliberately none of the three colours a focus block can be.
//
// Red was the other candidate and is spoken for: it is the only red this tool
// draws, so red on the bar means a program has failed and nothing else. Yellow
// is the next most alarming thing an LED matrix does well, and against blue,
// green and orange it reads as a different kind of thing rather than as a
// focus block in a phase you had not seen before.
const ALERT_COLOR = "#FFCC00FF";

export { ALERT_COLOR, LEAD_MINUTES };
export type { Appointment };
