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
import { LEAD_MINUTES } from "./appointment.ts";
import type { ConfigSection } from "../../config/section.ts";

const CALENDARS_KEY = "calendars";
const LEAD_KEY = "lead";
const REFRESH_KEY = "refresh";
const STALE_KEY = "stale";
const SOUND_KEY = "sound";
const SOUND_LEAD_KEY = "lead";
const SOUND_LINGER_KEY = "linger";

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

// How long before the start an alert begins to make a noise, in seconds.
//
// Thirty is what the program was asked for, and it is the number the sound is
// for: five minutes of yellow is a thing you can look at and go back to what
// you were doing, and thirty seconds is the point at which looking is no
// longer enough.
const DEFAULT_SOUND_LEAD_SECONDS = 30;

// How long an unacknowledged sound keeps going past the start, in seconds.
//
// It has to end somehow. The alert is meant to continue until it is
// acknowledged, and an unattended bar acknowledges nothing -- so without a
// limit, one appointment nobody was there for leaves the bar chiming until
// somebody comes back to the desk, which is a worse thing to walk in on than a
// missed meeting.
//
// Two minutes is long enough to reach the bar from the next room and short
// enough that a bar left alone falls quiet before anybody minds.
const DEFAULT_SOUND_LINGER_SECONDS = 120;

// The sound an appointment makes as it comes up, in milliseconds.
interface SoundSettings {
	readonly leadMs: number;
	readonly lingerMs: number;
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
	// How much warning an appointment whose calendar asks for none gets, in
	// milliseconds.
	//
	// See LEAD_MINUTES. How far away somebody's meetings are is a fact about
	// their day, so the file is where it gets stated -- for the entries that
	// leave the question open.
	readonly leadMs: number;
	readonly sound: SoundSettings;
	// How often to read the calendars again, in milliseconds.
	readonly refreshMs: number;
	// How old the last successful read may be before a failure to read again is
	// drawn rather than logged.
	readonly staleMs: number;
	// Where a setting is written, so that a message about a feed that could
	// not be read can say which line to go and fix.
	readonly where: (key: string) => string;
}

const soundIn = (section: ConfigSection): SoundSettings => {
	const sound = {
		leadMs:
			section.number(SOUND_LEAD_KEY, DEFAULT_SOUND_LEAD_SECONDS) *
			MS_PER_SECOND,
		lingerMs:
			section.number(SOUND_LINGER_KEY, DEFAULT_SOUND_LINGER_SECONDS) *
			MS_PER_SECOND,
	};

	section.done();

	return sound;
};

const eventSettings = (config: ConfigSection): EventSettings => ({
	calendars: config.strings(CALENDARS_KEY),
	leadMs: config.number(LEAD_KEY, LEAD_MINUTES) * MS_PER_MINUTE,
	sound: soundIn(config.section(SOUND_KEY)),
	refreshMs:
		config.number(REFRESH_KEY, DEFAULT_REFRESH_MINUTES) * MS_PER_MINUTE,
	staleMs: config.number(STALE_KEY, DEFAULT_STALE_HOURS) * MS_PER_HOUR,
	where: config.where,
});

export {
	CALENDARS_KEY,
	DEFAULT_REFRESH_MINUTES,
	DEFAULT_SOUND_LEAD_SECONDS,
	DEFAULT_SOUND_LINGER_SECONDS,
	DEFAULT_STALE_HOURS,
	LEAD_KEY,
	REFRESH_KEY,
	SOUND_KEY,
	STALE_KEY,
	eventSettings,
};
export type { EventSettings, SoundSettings };
