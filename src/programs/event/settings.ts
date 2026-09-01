// What `event` reads out of its block of the config file.
//
// The settings are read here and nowhere else, so the answer to "what can this
// program be told to do?" is this file rather than a search for whatever reads
// a value somewhere in the folder.

import {
	MS_PER_HOUR,
	MS_PER_MINUTE,
	MS_PER_SECOND,
} from "../../constants/time.ts";
import type { ConfigSection } from "../../config/section.ts";

const CALENDARS_KEY = "calendars";
const REFRESH_KEY = "refresh";
const STALE_KEY = "stale";
const SCREEN_KEY = "screen";
const CHIME_KEY = "chime";
const BEFORE_KEY = "before";
const UNTIL_KEY = "until";
const EVERY_KEY = "every";

// How often the calendars are read again, in minutes.
//
// Five is a compromise between two costs that both fall on somebody else. Each
// read is a fetch of every configured feed, which for a Google calendar is
// megabytes of a whole year's history; and anything added to a calendar is
// invisible to the bar until the next one. Five minutes means a meeting entered
// on the way to it is seen in time to be warned about, without asking a feed
// for a year of history twelve times an hour.
//
// It is the one number here that is about somebody else's server rather than
// about your day, which is why it is worth being able to move without editing
// the program.
const DEFAULT_REFRESH_MINUTES = 5;

// How old the last calendar read may be before a failure takes the screen, in
// hours.
//
// A read that fails does not throw away what the last one found, so the
// question this answers is how long those appointments are still worth
// drawing. "I could not read the calendar just now" and "I have not read the
// calendar since yesterday" are different facts, and only the second is worth
// the display: silence is what this program looks like when it is working, so
// a feed nobody can read has to become visible eventually or a bar showing
// nothing means both a quiet afternoon and a broken subscription.
//
// A day is where those two costs cross. A schedule read this morning is still
// most of what today holds, and one read yesterday is not today's at all.
const DEFAULT_STALE_HOURS = 24;

// How long before a trigger the alert goes on screen, in seconds.
//
// A trigger is an instant a calendar asked to be reminded at, and by far the
// commonest one asks for the moment the meeting begins. Arriving exactly then
// would make the bar an announcement rather than a warning, so the screen runs
// ahead of every trigger by this much.
//
// Five minutes is long enough to finish a sentence and click a link, and
// deliberately not long enough to cross town: an appointment that needs more
// warning than this has a calendar that can ask for it.
const DEFAULT_SCREEN_BEFORE_SECONDS = 300;

// How long an unacknowledged alert stays on screen past its trigger, in
// seconds.
//
// It has to end somehow. The alert is meant to continue until it is
// acknowledged, and an unattended bar acknowledges nothing -- so without a
// limit, one appointment nobody was there for leaves the bar lit and chiming
// until somebody comes back to the desk, which is a worse thing to walk in on
// than a missed meeting.
//
// Two minutes is long enough to reach the bar from the next room and short
// enough that a bar left alone falls quiet before anybody minds.
const DEFAULT_SCREEN_UNTIL_SECONDS = 120;

// How long before a trigger the alert begins to make a noise, in seconds.
//
// Thirty is what the program was asked for: five minutes of yellow is a thing
// you can look at and go back to what you were doing, and thirty seconds is the
// point at which looking is no longer enough.
const DEFAULT_CHIME_BEFORE_SECONDS = 30;

// How long the noise keeps going past its trigger, in seconds.
const DEFAULT_CHIME_UNTIL_SECONDS = 120;

// How long between one playing of the chime and the next, in seconds.
//
// The clip is under two seconds and the alert is supposed to keep asking until
// it is answered, so it is played again and again rather than once. Ten seconds
// leaves a clear gap between chimes -- which is what makes it read as an alarm
// wanting an answer rather than as a siren -- and is slow enough that a repeat,
// which costs a draw, is not asking for one every couple of seconds.
const DEFAULT_CHIME_EVERY_SECONDS = 10;

// When an alert is on screen, relative to its trigger, in milliseconds.
interface ScreenSettings {
	readonly beforeMs: number;
	readonly untilMs: number;
}

// When an alert makes a noise, relative to its trigger, and how often, in
// milliseconds.
interface ChimeSettings {
	readonly beforeMs: number;
	readonly untilMs: number;
	readonly everyMs: number;
}

interface EventSettings {
	// The appointment calendars to watch, as `https` URLs or paths to `.ics`
	// files. Any number of them: they are read independently and the
	// appointments are pooled, so which feed a given appointment came from
	// stops mattering the moment it is read.
	//
	// An empty list is not an error here. It is the program's own `start` that
	// refuses it, so that the message can say what to do about it.
	readonly calendars: string[];
	// What the bar does around each of an appointment's triggers.
	//
	// Every window this program draws is measured from a trigger rather than
	// from the appointment, so these two blocks are the whole of its timing.
	readonly screen: ScreenSettings;
	readonly chime: ChimeSettings;
	// How often to read the calendars again, in milliseconds.
	readonly refreshMs: number;
	// How old the last successful read may be before a failure to read again is
	// drawn rather than logged.
	readonly staleMs: number;
	// Where a setting is written, so that a message about a feed that could
	// not be read can say which line to go and fix.
	readonly where: (key: string) => string;
}

// Nested blocks are not checked by the runner, which only holds the program's
// own block to what it read -- so each of these says it is done with its
// section. Without that, `screen: befor: 1` would be a line that plainly says
// what the bar should do and silently does nothing.
const screenIn = (section: ConfigSection): ScreenSettings => {
	const screen = {
		beforeMs:
			section.number(BEFORE_KEY, DEFAULT_SCREEN_BEFORE_SECONDS) * MS_PER_SECOND,
		untilMs:
			section.number(UNTIL_KEY, DEFAULT_SCREEN_UNTIL_SECONDS) * MS_PER_SECOND,
	};

	section.done();

	return screen;
};

const chimeIn = (section: ConfigSection): ChimeSettings => {
	const chime = {
		beforeMs:
			section.number(BEFORE_KEY, DEFAULT_CHIME_BEFORE_SECONDS) * MS_PER_SECOND,
		untilMs:
			section.number(UNTIL_KEY, DEFAULT_CHIME_UNTIL_SECONDS) * MS_PER_SECOND,
		// Not `number`, because zero here is not "no gap between chimes" but
		// "no gap at all": the chime would play on every draw and ask for the
		// next one immediately.
		everyMs:
			section.positiveNumber(EVERY_KEY, DEFAULT_CHIME_EVERY_SECONDS) *
			MS_PER_SECOND,
	};

	section.done();

	return chime;
};

const eventSettings = (config: ConfigSection): EventSettings => ({
	calendars: config.strings(CALENDARS_KEY),
	screen: screenIn(config.section(SCREEN_KEY)),
	chime: chimeIn(config.section(CHIME_KEY)),
	refreshMs:
		config.number(REFRESH_KEY, DEFAULT_REFRESH_MINUTES) * MS_PER_MINUTE,
	staleMs: config.number(STALE_KEY, DEFAULT_STALE_HOURS) * MS_PER_HOUR,
	where: config.where,
});

export {
	CALENDARS_KEY,
	CHIME_KEY,
	DEFAULT_CHIME_BEFORE_SECONDS,
	DEFAULT_CHIME_EVERY_SECONDS,
	DEFAULT_CHIME_UNTIL_SECONDS,
	DEFAULT_REFRESH_MINUTES,
	DEFAULT_SCREEN_BEFORE_SECONDS,
	DEFAULT_SCREEN_UNTIL_SECONDS,
	DEFAULT_STALE_HOURS,
	REFRESH_KEY,
	SCREEN_KEY,
	STALE_KEY,
	eventSettings,
};
export type { ChimeSettings, EventSettings, ScreenSettings };
