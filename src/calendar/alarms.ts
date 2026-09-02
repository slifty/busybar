import ICAL from "ical.js";
import { MS_PER_SECOND } from "../constants/time.ts";

// When a calendar asked to be reminded about an entry.
//
// A `VALARM` is the calendar's own answer to "how much warning is this worth?",
// which is a question this tool would otherwise have to guess at. Reading them
// is what lets an appointment carry its own warning rather than take whatever
// the config file gives everything.
//
// What comes back are instants rather than the offsets the feed writes, because
// an offset is only meaningful next to the occurrence it hangs off -- and a
// recurring event's occurrences each have their own.

// `ICAL` is exposed as a namespace object rather than as named exports, so the
// instance types have to be recovered from the constructors.
type Component = InstanceType<typeof ICAL.Component>;
type Property = InstanceType<typeof ICAL.Property>;

// Triggers measured from the end rather than the start, which is legal and
// rare. The parameter is absent for the ordinary case.
const RELATED = "related";
const END = "END";

// The alarm actions worth putting on a bar.
//
// `DISPLAY` and `AUDIO` are both a calendar asking for somebody's attention at
// a moment, which is exactly what this program does with them.
//
// `EMAIL` is not: it asks for a message to be sent, and the person it is sent
// to is not necessarily the person standing in front of the bar.
//
// `NONE` is stranger and more common than either. It is what a client writes to
// say "do not apply your default alarm here" -- Apple's carries a trigger of
// `19760401T005545Z`, an instant chosen for being absurd. It is a suppression
// rather than a request, and honouring it would put an alert on the bar for a
// calendar entry that deliberately asked for none.
const ATTENTION_ACTIONS = new Set(["DISPLAY", "AUDIO"]);

const actionOf = (alarm: Component): string | undefined => {
	const action: unknown = alarm.getFirstPropertyValue("action");

	return typeof action === "string" ? action.toUpperCase() : undefined;
};

// Where a trigger lands, before asking whether it is any use.
//
// The two shapes RFC 5545 allows, told apart by what `ical.js` builds rather
// than by the `VALUE` parameter, which a feed may leave off. `toSeconds` has
// already normalised the several spellings a feed uses for the same offset:
// `-PT5M` and `-P0DT0H5M0S` both arrive as -300, and real calendars write both.
//
// `RELATED=END` measures from the end instead, which a calendar writes for a
// reminder about a thing finishing rather than starting.
const landingOf = (
	trigger: Property,
	start: Date,
	end: Date,
): Date | undefined => {
	const value: unknown = trigger.getFirstValue();

	if (value instanceof ICAL.Time) {
		return value.toJSDate();
	}

	if (!(value instanceof ICAL.Duration)) {
		return undefined;
	}

	const from = trigger.getParameter(RELATED) === END ? end : start;

	return new Date(from.getTime() + value.toSeconds() * MS_PER_SECOND);
};

// One alarm, as the instant it asks for -- or nothing, when it asks for
// something this program has no use for.
const instantFor = (
	alarm: Component,
	start: Date,
	end: Date,
): Date | undefined => {
	const action = actionOf(alarm);

	if (action === undefined || !ATTENTION_ACTIONS.has(action)) {
		return undefined;
	}

	const trigger: Property | null = alarm.getFirstProperty("trigger");

	if (trigger === null) {
		return undefined;
	}

	const landing = landingOf(trigger, start, end);

	// One rule, applied to wherever the trigger actually landed, and it comes
	// from what this program is for: an appointment is about its start, so an
	// alarm after that has nothing left to warn anybody about. The bar would
	// draw it against a clock already reading zero.
	//
	// Asking the question of the instant rather than of the offset is what
	// makes it one rule. There are three ways to land late -- an offset that
	// is simply positive, a `RELATED=END` one whose event outruns it, and a
	// fixed instant, which no arithmetic on an offset would ever catch -- and
	// reading them separately is how they came to disagree.
	if (landing === undefined || landing.getTime() > start.getTime()) {
		return undefined;
	}

	return landing;
};

// Every instant this entry's alarms ask for, soonest first.
//
// Duplicates are kept rather than merged: two alarms asking for the same
// instant are two lines in the calendar, and nothing downstream is worse off
// for seeing both.
const alarmsOf = (component: Component, start: Date, end: Date): Date[] =>
	component
		.getAllSubcomponents("valarm")
		.flatMap((alarm) => {
			const instant = instantFor(alarm, start, end);

			return instant === undefined ? [] : [instant];
		})
		.sort((a, b) => a.getTime() - b.getTime());

export { alarmsOf };
