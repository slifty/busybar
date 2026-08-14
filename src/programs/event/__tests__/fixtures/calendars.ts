// iCalendar feeds, written out in full rather than built by a helper.
//
// The point of these tests is that real calendar text is read correctly, and a
// builder would quietly encode this project's assumptions about what that text
// looks like -- which is the thing under test.
//
// Every title says TEST, and none of them is a plausible meeting. A fixture
// wearing a real name is one screenshot away from being mistaken for a real
// calendar, and what these are testing is shape -- a location, a link, both,
// neither -- rather than anything about a real day.

const calendar = (...body: string[]): string =>
	[
		"BEGIN:VCALENDAR",
		"VERSION:2.0",
		"PRODID:-//busybar//test//EN",
		...body,
		"END:VCALENDAR",
	].join("\r\n");

// Somewhere to physically be: the long lead.
const LOCATED_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:located@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"LOCATION:TEST Room 4",
	"SUMMARY:TEST Located",
	"END:VEVENT",
);

// A link in the standard property: the short lead.
const URL_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:url@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"URL:https://example.test/call",
	"SUMMARY:TEST Url",
	"END:VEVENT",
);

// What Google Calendar actually writes for a Meet link, and the one that turns
// up most in practice.
const GOOGLE_CONFERENCE_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:meet@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"X-GOOGLE-CONFERENCE:https://meet.example.test/abc-defg-hij",
	"SUMMARY:TEST Conference",
	"END:VEVENT",
);

// A link written where a place was asked for, which calendars do constantly.
// Reading this as somewhere to travel to would give every desk call half an
// hour of warning.
const URL_IN_LOCATION_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:url-in-location@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"LOCATION:https://example.test/call",
	"SUMMARY:TEST Url In Location",
	"END:VEVENT",
);

// A deep link rather than an https one, which is what a calendar writes when
// the meeting is joined through an app rather than a browser. Still a link:
// you join it from wherever you are sitting.
const APP_LINK_IN_LOCATION_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:app-link@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"LOCATION:zoommtg://zoom.us/join?confno=123456789",
	"SUMMARY:TEST App Link",
	"END:VEVENT",
);

// A dial-in number, which is also not somewhere to travel to.
const TEL_IN_LOCATION_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:tel@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"LOCATION:tel:+15550001234",
	"SUMMARY:TEST Dial In",
	"END:VEVENT",
);

// A path, which parses as a URL with a one-character scheme and is a place.
// The only thing that produces such a scheme, and the reason the check is not
// simply "does it parse".
const DRIVE_LETTER_LOCATION_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:drive-letter@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"LOCATION:C:\\rooms\\4",
	"SUMMARY:TEST Drive Letter",
	"END:VEVENT",
);

// A room whose name happens to carry a colon. Not a URL: the text before the
// colon has a space in it, so it cannot be a scheme.
const COLON_IN_ROOM_NAME_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:colon-room@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"LOCATION:TEST Conference Room: Annex",
	"SUMMARY:TEST Colon Room",
	"END:VEVENT",
);

// In a room and dialled into as well. Travel is the binding constraint, so the
// room wins.
const LOCATED_AND_LINKED_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:both@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"LOCATION:TEST Room 4",
	"X-GOOGLE-CONFERENCE:https://meet.example.test/abc-defg-hij",
	"SUMMARY:TEST Both",
	"END:VEVENT",
);

// Neither a place nor a link.
const PLAIN_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:plain@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Plain",
	"END:VEVENT",
);

// A LOCATION written with nothing after it says no more than one left out.
const BLANK_LOCATION_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:blank-location@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"LOCATION:",
	"SUMMARY:TEST Blank Location",
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
	APP_LINK_IN_LOCATION_EVENT,
	BLANK_LOCATION_EVENT,
	CANCELLED_EVENT,
	COLON_IN_ROOM_NAME_EVENT,
	DRIVE_LETTER_LOCATION_EVENT,
	ENDLESS_EVENT,
	GOOGLE_CONFERENCE_EVENT,
	INSTANT_EVENT,
	LOCATED_AND_LINKED_EVENT,
	LOCATED_EVENT,
	PLAIN_EVENT,
	TEL_IN_LOCATION_EVENT,
	UNDRAWABLE_TITLE_EVENT,
	URL_EVENT,
	URL_IN_LOCATION_EVENT,
};
