// What `focus` reads out of its block of the config file.
//
// The settings are read here and nowhere else, so the answer to "what can this
// program be told to do?" is this file rather than a search for whatever reads
// a value somewhere in the folder.

import type { ConfigSection } from "../../config/section.ts";

// Where the schedule is read from when no calendar is set, relative to the
// working directory.
//
// `local/` is git-ignored wholesale: it is where anything personal to one
// machine lives, which a schedule of what somebody is doing all day plainly
// is.
const DEFAULT_FOCUS_FILE = "local/focus.json";

const CALENDAR_KEY = "calendar";
const FILE_KEY = "file";

interface FocusSettings {
	// An iCalendar feed to read blocks from, as an https URL or a path to an
	// .ics file. Undefined means there is no calendar, which is not the same
	// as a default one: it is what puts the schedule file below in charge.
	readonly calendar: string | undefined;
	readonly file: string;
	// Where a setting is written, so that a message about a file that could
	// not be read can say which line to go and fix.
	readonly where: (key: string) => string;
}

const focusSettings = (config: ConfigSection): FocusSettings => ({
	calendar: config.optionalString(CALENDAR_KEY),
	file: config.string(FILE_KEY, DEFAULT_FOCUS_FILE),
	where: config.where,
});

export { CALENDAR_KEY, DEFAULT_FOCUS_FILE, FILE_KEY, focusSettings };
export type { FocusSettings };
