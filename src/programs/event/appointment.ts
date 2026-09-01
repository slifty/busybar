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

// How much warning an appointment gets when its calendar asks for none, in
// minutes.
//
// Only when it asks for none. An entry carrying an alarm has said what it
// wants and gets that instead -- nothing else a calendar carries says
// reliably how much warning a thing is worth, so a number meant for everything
// is what to fall back on rather than what to insist on.
//
// Five minutes is long enough to finish a sentence and click a link, and
// deliberately not long enough to cross town.
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
