// One occurrence of a calendar entry, as the calendar describes it and before
// any program has decided what to make of it.
//
// This is the seam between reading iCalendar and using it. `focus` turns these
// into blocks it counts down; `event` turns them into appointments it alerts
// ahead of. The two disagree about what is worth keeping -- an entry with no
// duration is nothing to count down and a perfectly good "be somewhere at
// two" -- so what to drop belongs to whichever program is mapping, and nothing
// is discarded here for being uninteresting. What is discarded here is only
// what is not an occurrence at all: an entry the calendar has cancelled, and
// anything outside the window being read.
interface Occurrence {
	// Verbatim, including anything the display cannot draw. Reducing it to
	// what the fonts have is the mapper's job, since it is the mapper that
	// knows whether an unrenderable title is a reason to skip the entry
	// quietly or a reason to stop and say so.
	readonly summary: string;
	readonly start: Date;
	// For an entry with no end and no duration, the same instant as the start.
	// A calendar is entitled to say that something happens at two o'clock
	// without saying when it stops.
	readonly end: Date;
	// All-day entries begin on a date rather than at a time, so they carry no
	// hour to be on time for and no span worth counting down. Both programs
	// drop them, for reasons of their own.
	readonly allDay: boolean;
	// Where the calendar says it is, verbatim and uninterpreted. Whether that
	// text is a room or a video call is a question about appointments, not
	// about calendars, so it is not asked here.
	readonly location: string | undefined;
	// A URL the calendar attached to the entry, from whichever of the places
	// calendars put one.
	readonly url: string | undefined;
}

export type { Occurrence };
