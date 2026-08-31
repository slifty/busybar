// iCalendar feeds, written out in full rather than built by a helper.
//
// The point of these tests is that real calendar text is read correctly, and a
// builder would quietly encode this project's assumptions about what that text
// looks like -- which is the thing under test.
//
// Every title says TEST, and none of them is a plausible meeting. A fixture
// wearing a real name is one screenshot away from being mistaken for a real
// calendar, and what these are testing is shape -- an instant rather than a
// span, a day rather than a time, a title with nothing drawable in it -- rather
// than anything about a real day.

const calendar = (...body: string[]): string =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//busybar//test//EN",
		...body,
		"END:VCALENDAR",
	].join("\r\n");

// Somewhere to physically be.
const LOCATED_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:located@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"LOCATION:TEST Room 4",
	"SUMMARY:TEST Located",
	"END:VEVENT",
);

// The same appointment with nothing said about where it is. Read against
// LOCATED_EVENT, this is what "the place makes no difference" means.
const PLACELESS_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:placeless@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Located",
	"END:VEVENT",
);

// An instant rather than a span. `focus` drops these and this program must not:
// being on time for it is the whole job.
const INSTANT_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:instant@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T090000Z",
	"SUMMARY:TEST Instant",
	"END:VEVENT",
);

// No DTEND and no DURATION at all, which is legal and means the same thing.
const ENDLESS_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:endless@busybar.test",
	"DTSTART:20260102T090000Z",
	"SUMMARY:TEST Endless",
	"END:VEVENT",
);

// Begins on a date rather than at a time, so there is no instant to be on time
// for.
const ALL_DAY_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:all-day@busybar.test",
	"DTSTART;VALUE=DATE:20260102",
	"DTEND;VALUE=DATE:20260103",
	"SUMMARY:TEST All Day",
	"END:VEVENT",
);

// A title the bitmap fonts cannot render any part of.
const UNDRAWABLE_TITLE_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:undrawable@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:🎯🔥",
	"END:VEVENT",
);

const CANCELLED_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:cancelled@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"STATUS:CANCELLED",
	"SUMMARY:TEST Cancelled",
	"END:VEVENT",
);

export {
	ALL_DAY_EVENT,
	CANCELLED_EVENT,
	ENDLESS_EVENT,
	INSTANT_EVENT,
	LOCATED_EVENT,
	PLACELESS_EVENT,
	UNDRAWABLE_TITLE_EVENT,
};
