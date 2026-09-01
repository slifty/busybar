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

// A calendar asking for ten minutes of warning: the ordinary shape, and the
// only per-entry answer to "how much warning is this worth?" there is.
const ALARMED_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:alarmed@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Alarmed",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER:-PT10M",
	"END:VALARM",
	"END:VEVENT",
);

// The same five minutes written the long way, which is what Google actually
// writes. Both spellings have to mean the same instant.
const VERBOSE_ALARM_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:verbose-alarm@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Verbose Alarm",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER:-P0DT0H5M0S",
	"END:VALARM",
	"END:VEVENT",
);

// Two alarms on one entry, which is what a calendar writes when somebody asks
// for a second reminder rather than moves the first.
const TWICE_ALARMED_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:twice-alarmed@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Twice Alarmed",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER:P0D",
	"END:VALARM",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER:-PT5M",
	"END:VALARM",
	"END:VEVENT",
);

// What a client writes to say "do not apply your default alarm here". The
// instant is absurd on purpose. It is a suppression rather than a request.
const SUPPRESSED_ALARM_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:suppressed@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Suppressed",
	"BEGIN:VALARM",
	"ACTION:NONE",
	"TRIGGER;VALUE=DATE-TIME:19760401T005545Z",
	"END:VALARM",
	"END:VEVENT",
);

// An alarm asking for a message to be sent, which is not a request to
// interrupt whoever is standing in front of the bar.
const EMAILED_ALARM_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:emailed@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Emailed",
	"BEGIN:VALARM",
	"ACTION:EMAIL",
	"TRIGGER:-PT1H",
	"END:VALARM",
	"END:VEVENT",
);

// A fixed instant rather than an offset, which is legal and which a calendar
// writes when the reminder is not about the entry's own timing.
const ABSOLUTE_ALARM_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:absolute@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Absolute",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER;VALUE=DATE-TIME:20260102T070000Z",
	"END:VALARM",
	"END:VEVENT",
);

// A reminder measured from the end rather than the start, which is legal and
// rare. Ninety minutes before a ten o'clock finish is half past eight, which is
// before the thing starts and so still a warning about it.
const END_RELATED_ALARM_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:end-related@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST End Related",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER;RELATED=END:-PT90M",
	"END:VALARM",
	"END:VEVENT",
);

// The same thing measured from the end, on an event long enough that it lands
// after the start. Quarter to ten is three quarters of an hour into a nine
// o'clock, and a bar cannot warn anybody about a meeting they are already in.
const LATE_END_RELATED_ALARM_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:late-end-related@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Late End Related",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER;RELATED=END:-PT15M",
	"END:VALARM",
	"END:VEVENT",
);

// A fixed instant after the entry has begun. No arithmetic on an offset would
// ever catch this one, which is why the question is asked of where the trigger
// landed rather than of what it was written as.
const LATE_ABSOLUTE_ALARM_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:late-absolute@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Late Absolute",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER;VALUE=DATE-TIME:20260102T094500Z",
	"END:VALARM",
	"END:VEVENT",
);

// A trigger that fires after the thing it is about. Nothing a bar warning you
// about what is coming can do with it.
const LATE_ALARM_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:late-alarm@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"SUMMARY:TEST Late Alarm",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER:PT9H",
	"END:VALARM",
	"END:VEVENT",
);

// A daily series carrying one alarm. The offset has to land on each
// occurrence's own day rather than on the series' first.
const RECURRING_ALARM_EVENT = calendar(
	"BEGIN:VEVENT",
	"UID:recurring-alarm@busybar.test",
	"DTSTART:20260102T090000Z",
	"DTEND:20260102T100000Z",
	"RRULE:FREQ=DAILY;COUNT=2",
	"SUMMARY:TEST Recurring Alarm",
	"BEGIN:VALARM",
	"ACTION:DISPLAY",
	"TRIGGER:-PT10M",
	"END:VALARM",
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
	ABSOLUTE_ALARM_EVENT,
	ALARMED_EVENT,
	ALL_DAY_EVENT,
	CANCELLED_EVENT,
	EMAILED_ALARM_EVENT,
	END_RELATED_ALARM_EVENT,
	ENDLESS_EVENT,
	INSTANT_EVENT,
	LATE_ABSOLUTE_ALARM_EVENT,
	LATE_ALARM_EVENT,
	LATE_END_RELATED_ALARM_EVENT,
	LOCATED_EVENT,
	PLACELESS_EVENT,
	RECURRING_ALARM_EVENT,
	SUPPRESSED_ALARM_EVENT,
	TWICE_ALARMED_EVENT,
	UNDRAWABLE_TITLE_EVENT,
	VERBOSE_ALARM_EVENT,
};
