import {
	HORIZON_HOURS,
	LOOKBACK_HOURS,
	parseCalendar as readOccurrences,
} from "../../calendar/parse.ts";
import { drawableName } from "../../text.ts";
import type { Occurrence } from "../../calendar/occurrence.ts";
import type { Focus } from "./focus.ts";

// Turns calendar occurrences into focus blocks.
//
// Reading the feed itself -- recurrence, overrides, timezones, cancellation --
// belongs to `src/calendar/` and is shared with every other program that reads
// one. What is left here is the part only `focus` can answer: which of those
// occurrences is a block of time worth counting down, and what its name is.
//
// This is the seam a real calendar plugs into: everything above it -- resolving
// overlaps, picking the current block, colouring it, drawing it -- is written
// against blocks, and does not care that they came from a calendar rather than
// from a file someone typed.

// One occurrence, as a block -- or nothing, when the calendar says something
// the display cannot.
//
// Three kinds of entry are dropped rather than drawn, and all three are dropped
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
//     down to and which no drawing could describe. This is where `focus` and
//     `event` part company: an entry with no duration is a perfectly good
//     appointment to be on time for, and nothing at all to count down.
const blockFrom = ({
	summary,
	start,
	end,
	allDay,
}: Occurrence): Focus | undefined => {
	if (allDay) {
		return undefined;
	}

	const name = drawableName(summary);

	if (name === "") {
		return undefined;
	}

	if (end.getTime() <= start.getTime()) {
		return undefined;
	}

	return { name, start, end };
};

// Reads an iCalendar feed into the focus blocks that fall near `now`.
const parseCalendar = (text: string, now: Date, source: string): Focus[] =>
	readOccurrences(text, now, source).flatMap((occurrence) => {
		const block = blockFrom(occurrence);

		return block === undefined ? [] : [block];
	});

export { HORIZON_HOURS, LOOKBACK_HOURS, parseCalendar };
