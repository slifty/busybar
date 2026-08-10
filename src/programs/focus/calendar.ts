import ICAL from "ical.js";
import { MS_PER_HOUR } from "../../constants/time.ts";
import { drawableName } from "./name.ts";
import type { Focus } from "./focus.ts";

// Turns an iCalendar feed into focus blocks.
//
// This is the seam a real calendar plugs into: everything above it -- resolving
// overlaps, picking the current block, colouring it, drawing it -- is written
// against blocks, and does not care that they came from a calendar rather than
// from a file someone typed.
//
// `ICAL` is exposed as a namespace object rather than as named exports, so the
// instance types have to be recovered from the constructors.
type Component = InstanceType<typeof ICAL.Component>;
type CalendarEvent = InstanceType<typeof ICAL.Event>;
type CalendarTime = InstanceType<typeof ICAL.Time>;
// A recurrence expansion, narrowed to the one method used and to what that
// method really returns.
//
// `next()` is typed as always returning a time, and does not: it yields nothing
// once the series is exhausted, which the library's own examples loop on.
// Stating that here is what makes the end of a series something the type
// checker can see, rather than a crash on the occurrence after the last one.
interface Expansion {
	readonly next: () => CalendarTime | undefined;
}

// What one expanded occurrence is, restated locally.
//
// `ical.js` describes this in a `types.d.ts` whose own relative imports carry
// no file extensions, so nothing in it resolves under `nodenext` module
// resolution and every member of it arrives untyped. The shape is small,
// stable and documented, so it is written out here and the untyped edge is
// confined to the one adapter below rather than spreading through the file.
interface Occurrence {
	readonly item: CalendarEvent;
	readonly startDate: CalendarTime;
	readonly endDate: CalendarTime;
}

const detailsOf = (
	event: CalendarEvent,
	occurrence: CalendarTime,
): Occurrence => event.getOccurrenceDetails(occurrence);

const expansionOf = (event: CalendarEvent): Expansion => event.iterator();

// How much of the calendar is turned into blocks, either side of now.
//
// A recurring event describes infinitely many occurrences, so expanding one has
// to stop somewhere. The horizon is what decides how long a run of this tool
// stays useful without being restarted: blocks beyond it are invisible until
// the next read, and the schedule is read on every draw, so in practice it only
// has to outlast the gap between draws.
//
// The lookback is not symmetric with it and is not meant to be. Its only job is
// to catch a block that started before now and is still running, which a
// day is far more than enough for.
const LOOKBACK_HOURS = 24;
const HORIZON_HOURS = 48;

const LOOKBACK_MS = LOOKBACK_HOURS * MS_PER_HOUR;
const HORIZON_MS = HORIZON_HOURS * MS_PER_HOUR;

// How many occurrences of one series will be stepped through before giving up
// on it.
//
// A series has to be expanded from its own start, so reaching next Tuesday
// means stepping through every Tuesday since the series began -- and a rule
// with no COUNT or UNTIL never ends on its own. The bound is generous enough
// for anything real: a daily event would have to have been running for
// twenty-seven years to reach it, while a runaway rule reaches it immediately
// and costs a few milliseconds rather than the draw it was expanded for.
const MAX_EXPANSION_STEPS = 10_000;

// Events the calendar itself says are off.
const CANCELLED = "CANCELLED";

const isCancelled = (event: CalendarEvent): boolean =>
	event.component.getFirstPropertyValue("status") === CANCELLED;

// Whether a block is worth keeping, given the window being expanded.
//
// Overlap rather than containment: a block that started before the window began
// but has not finished is precisely the block most likely to be on screen.
const overlapsWindow = (block: Focus, from: Date, to: Date): boolean =>
	block.start.getTime() < to.getTime() && block.end.getTime() > from.getTime();

// One occurrence, as a block -- or nothing, when the calendar says something
// the display cannot.
//
// Three kinds of event are dropped rather than drawn, and all three are dropped
// quietly, because a calendar is not written for this tool and one odd entry in
// it should not take the whole schedule down:
//
//   - All-day events. Their start is a date rather than a time, so they would
//     become blocks running midnight to midnight -- and since an overlapping
//     block is discarded outright in favour of whichever starts earlier, a
//     single all-day event would suppress every real block of that day.
//   - Events whose title has nothing the display can render. A name is the
//     whole of what a block says, and a blank row says nothing.
//   - Events that end no later than they start, which the device cannot count
//     down to and which no drawing could describe.
const blockFrom = (
	summary: string | null,
	start: CalendarTime,
	end: CalendarTime,
): Focus | undefined => {
	if (start.isDate) {
		return undefined;
	}

	const name = drawableName(summary ?? "");

	if (name === "") {
		return undefined;
	}

	const startAt = start.toJSDate();
	const endAt = end.toJSDate();

	if (endAt.getTime() <= startAt.getTime()) {
		return undefined;
	}

	return { name, start: startAt, end: endAt };
};

// When a recurring event happens, within the window.
//
// The expansion has to start where the series starts. Handing the iterator a
// later time does not fast-forward it -- it replaces the series' DTSTART, which
// moves every occurrence to the time of day it was handed and stops EXDATE
// lining up with anything. So the occurrences before the window are stepped
// through and thrown away, and the steps taken are what bounds the loop.
const occurrenceTimes = (
	event: CalendarEvent,
	from: Date,
	to: Date,
): CalendarTime[] => {
	const stepped: CalendarTime[] = [];
	const expansion = expansionOf(event);

	while (stepped.length < MAX_EXPANSION_STEPS) {
		const occurrence = expansion.next();

		if (
			occurrence === undefined ||
			occurrence.toJSDate().getTime() >= to.getTime()
		) {
			break;
		}

		stepped.push(occurrence);
	}

	// The lookback is what gives this its slack: an occurrence that began
	// before the window opened has been over for a day by then.
	return stepped.filter(
		(occurrence) => occurrence.toJSDate().getTime() >= from.getTime(),
	);
};

// Every occurrence of one event that lands in the window. A non-recurring event
// is its own single occurrence.
const occurrencesOf = (event: CalendarEvent, from: Date, to: Date): Focus[] => {
	if (isCancelled(event)) {
		return [];
	}

	if (!event.isRecurring()) {
		const block = blockFrom(event.summary, event.startDate, event.endDate);

		return block !== undefined && overlapsWindow(block, from, to)
			? [block]
			: [];
	}

	return occurrenceTimes(event, from, to).flatMap((occurrence) => {
		// Resolves RECURRENCE-ID overrides: an occurrence someone moved or
		// renamed comes back with the moved times and the new title, rather
		// than the ones the rule on its own would have produced.
		const details = detailsOf(event, occurrence);

		if (isCancelled(details.item)) {
			return [];
		}

		const block = blockFrom(
			details.item.summary,
			details.startDate,
			details.endDate,
		);

		return block !== undefined && overlapsWindow(block, from, to)
			? [block]
			: [];
	});
};

// Named timezones in an event refer to VTIMEZONE definitions carried by the
// calendar itself. Without registering them, a time written in a zone the
// library does not already know resolves as if it were UTC, which is a block
// drawn at the wrong hour rather than an error anybody would notice.
const registerTimezones = (calendar: Component): void => {
	for (const definition of calendar.getAllSubcomponents("vtimezone")) {
		const timezone = new ICAL.Timezone(definition);

		// Registered under its own TZID, which is what an event's TZID
		// parameter will name it by.
		if (!ICAL.TimezoneService.has(timezone.tzid)) {
			ICAL.TimezoneService.register(timezone);
		}
	}
};

// Collects the events, attaching each recurrence override to the event it
// overrides.
//
// A calendar stores an edited occurrence as a separate VEVENT sharing the
// series' UID and carrying a RECURRENCE-ID. Relating the two is what lets the
// expansion return the edit rather than what the rule would have said. An
// override whose series is absent -- which a feed trimmed to a date range can
// easily produce -- is kept as an event in its own right rather than dropped,
// since it is still a real block someone put in their calendar.
const eventsOf = (calendar: Component): CalendarEvent[] => {
	const series = new Map<string, CalendarEvent>();
	const overrides: Component[] = [];

	for (const vevent of calendar.getAllSubcomponents("vevent")) {
		const event = new ICAL.Event(vevent);

		if (event.isRecurrenceException()) {
			overrides.push(vevent);
		} else {
			series.set(event.uid, event);
		}
	}

	const orphans: CalendarEvent[] = [];

	for (const vevent of overrides) {
		const override = new ICAL.Event(vevent);
		const master = series.get(override.uid);

		if (master === undefined) {
			orphans.push(override);
		} else {
			master.relateException(vevent);
		}
	}

	return [...series.values(), ...orphans];
};

const parseJCal = (text: string, source: string): unknown => {
	try {
		return ICAL.parse(text);
	} catch (error) {
		throw new Error(`${source} is not a valid iCalendar feed`, {
			cause: error,
		});
	}
};

const parseComponent = (text: string, source: string): Component => {
	const jcal = parseJCal(text, source);

	// jCal is an array; a string or an object means the feed parsed as
	// something that was never a calendar.
	if (!Array.isArray(jcal)) {
		throw new Error(`${source} is not a valid iCalendar feed`);
	}

	const calendar = new ICAL.Component(jcal);

	// A feed that parses but is not a calendar is usually a sign-in page or an
	// error document served with a 200, which is worth saying plainly rather
	// than reporting as a calendar with no events in it.
	if (calendar.name !== "vcalendar") {
		throw new Error(
			`${source} is not a calendar: expected VCALENDAR, found ${calendar.name.toUpperCase()}`,
		);
	}

	return calendar;
};

// Reads an iCalendar feed into the focus blocks that fall near `now`.
const parseCalendar = (text: string, now: Date, source: string): Focus[] => {
	const calendar = parseComponent(text, source);

	registerTimezones(calendar);

	const from = new Date(now.getTime() - LOOKBACK_MS);
	const to = new Date(now.getTime() + HORIZON_MS);

	return eventsOf(calendar).flatMap((event) => occurrencesOf(event, from, to));
};

export { HORIZON_HOURS, LOOKBACK_HOURS, parseCalendar };
