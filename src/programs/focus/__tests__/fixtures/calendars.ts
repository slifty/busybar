// iCalendar feeds, written out in full rather than built by a helper.
//
// The point of these tests is that real calendar text is read correctly, and a
// builder would quietly encode this project's assumptions about what that text
// looks like -- which is the thing under test.

const calendar = (...body: string[]): string =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//busybar//test//EN",
		...body,
		"END:VCALENDAR",
	].join("\r\n");

// One ordinary timed event.
const SINGLE_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:single@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T103000Z",
	"SUMMARY:Deep Work",
	"END:VEVENT",
);

// Running when the window opens rather than starting inside it.
const STRADDLING_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:straddling@busybar.test",
	"DTSTART:20251231T230000Z",
	"DTEND:20260101T010000Z",
	"SUMMARY:Overnight",
	"END:VEVENT",
);

const DISTANT_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:distant@busybar.test",
	"DTSTART:20260401T090000Z",
	"DTEND:20260401T100000Z",
	"SUMMARY:Next Quarter",
	"END:VEVENT",
);

// A daily series with one occurrence excluded outright and one moved and
// renamed -- the two ways a calendar records an edit to a single occurrence.
const RECURRING_SERIES = calendar(
	"BEGIN:VEVENT",
	"UID:series@busybar.test",
	"DTSTART:20260101T090000Z",
	"DTEND:20260101T093000Z",
	"RRULE:FREQ=DAILY;COUNT=5",
	"EXDATE:20260103T090000Z",
	"SUMMARY:Standup",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:series@busybar.test",
	"RECURRENCE-ID:20260102T090000Z",
	"DTSTART:20260102T140000Z",
	"DTEND:20260102T143000Z",
	"SUMMARY:Standup (moved)",
	"END:VEVENT",
);

// A series with one occurrence called off rather than moved: the override
// carries the same UID and a RECURRENCE-ID, and says CANCELLED.
const SERIES_WITH_CANCELLED_OCCURRENCE = calendar(
	"BEGIN:VEVENT",
	"UID:partly-cancelled@busybar.test",
	"DTSTART:20260101T090000Z",
	"DTEND:20260101T093000Z",
	"RRULE:FREQ=DAILY;COUNT=3",
	"SUMMARY:Mostly On",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:partly-cancelled@busybar.test",
	"RECURRENCE-ID:20260102T090000Z",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T093000Z",
	"STATUS:CANCELLED",
	"SUMMARY:Mostly On",
	"END:VEVENT",
);

// An override whose series is nowhere in the feed, which a calendar trimmed to
// a date range produces readily enough.
const ORPHANED_OVERRIDE = calendar(
	"BEGIN:VEVENT",
	"UID:orphan@busybar.test",
	"RECURRENCE-ID:20260102T090000Z",
	"DTSTART:20260102T100000Z",
	"DTEND:20260102T110000Z",
	"SUMMARY:Orphaned Override",
	"END:VEVENT",
);

// A series short enough to run out before the window does, so the expansion
// reaches the end of the series rather than the edge of the window.
const EXHAUSTED_SERIES = calendar(
	"BEGIN:VEVENT",
	"UID:short@busybar.test",
	"DTSTART:20260101T090000Z",
	"DTEND:20260101T093000Z",
	"RRULE:FREQ=DAILY;COUNT=2",
	"SUMMARY:Short Series",
	"END:VEVENT",
);

// A time written in a named zone, with the definition of that zone alongside
// it, which is how a calendar carries anything other than UTC.
const ZONED_EVENT = calendar(
	"BEGIN:VTIMEZONE",
	"TZID:America/New_York",
	"BEGIN:DAYLIGHT",
	"TZOFFSETFROM:-0500",
	"TZOFFSETTO:-0400",
	"TZNAME:EDT",
	"DTSTART:19700308T020000",
	"RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU",
	"END:DAYLIGHT",
	"BEGIN:STANDARD",
	"TZOFFSETFROM:-0400",
	"TZOFFSETTO:-0500",
	"TZNAME:EST",
	"DTSTART:19701101T020000",
	"RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU",
	"END:STANDARD",
	"END:VTIMEZONE",
	"BEGIN:VEVENT",
	"UID:zoned@busybar.test",
	"DTSTART;TZID=America/New_York:20260102T090000",
	"DTEND;TZID=America/New_York:20260102T100000",
	"SUMMARY:Eastern Morning",
	"END:VEVENT",
);

const ALL_DAY_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:allday@busybar.test",
	"DTSTART;VALUE=DATE:20260102",
	"DTEND;VALUE=DATE:20260103",
	"SUMMARY:Conference",
	"END:VEVENT",
);

const CANCELLED_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:cancelled@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"STATUS:CANCELLED",
	"SUMMARY:Called Off",
	"END:VEVENT",
);

// A title the bitmap fonts can only partly render, and one they cannot render
// at all.
const AWKWARD_TITLES = calendar(
	"BEGIN:VEVENT",
	"UID:awkward@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:🎯 Focus: Q3 — Roadmap",
	"END:VEVENT",
	"BEGIN:VEVENT",
	"UID:undrawable@busybar.test",
	"DTSTART:20260102T110000Z",
	"DTEND:20260102T120000Z",
	"SUMMARY:🎯🔥",
	"END:VEVENT",
);

// Ends before it starts, which no drawing could describe.
const BACKWARDS_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:backwards@busybar.test",
	"DTSTART:20260102T100000Z",
	"DTEND:20260102T090000Z",
	"SUMMARY:Backwards",
	"END:VEVENT",
);

// Parses as iCalendar, but is not a calendar.
const NOT_A_CALENDAR = [
	"BEGIN:VCARD",
	"VERSION:4.0",
	"FN:Someone",
	"END:VCARD",
].join("\r\n");

export {
	ALL_DAY_EVENT,
	AWKWARD_TITLES,
	BACKWARDS_EVENT,
	CANCELLED_EVENT,
	DISTANT_EVENT,
	EXHAUSTED_SERIES,
	NOT_A_CALENDAR,
	ORPHANED_OVERRIDE,
	RECURRING_SERIES,
	SERIES_WITH_CANCELLED_OCCURRENCE,
	SINGLE_EVENT,
	STRADDLING_EVENT,
	ZONED_EVENT,
};
