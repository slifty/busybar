// What `event` reads out of its block of the config file.
//
// The settings are read here and nowhere else, so the answer to "what can this
// program be told to do?" is this file rather than a search for whatever reads
// a value somewhere in the folder.

import { MS_PER_MINUTE, MS_PER_SECOND } from "../../constants/time.ts";
import { LEAD_MINUTES } from "./appointment.ts";
import type { ConfigSection } from "../../config/section.ts";
import type { Kind } from "./appointment.ts";

const CALENDARS_KEY = "calendars";
const LEADS_KEY = "leads";
const REFRESH_KEY = "refresh";
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

// How long before the start an alert with no physical location begins to make
// a noise, in seconds.
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

// The sound an appointment with no physical location makes, in milliseconds.
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
	// How much warning each kind of appointment gets, in milliseconds.
	//
	// The numbers are an argument about travel time -- see LEAD_MINUTES -- and
	// an argument is exactly the kind of thing that should be settleable in a
	// file rather than in a comment. Whoever is being warned is the one who
	// knows how far away their meetings are.
	readonly leads: Readonly<Record<Kind, number>>;
	readonly sound: SoundSettings;
	// How often to read the calendars again, in milliseconds.
	readonly refreshMs: number;
	// Where a setting is written, so that a message about a feed that could
	// not be read can say which line to go and fix.
	readonly where: (key: string) => string;
}

// The leads block, in milliseconds, with the defaults for whatever it omits.
//
// The keys are the kinds themselves, written out one per line rather than
// derived from the kind list. Three lines say what the block takes; a loop
// would say it in a way you have to run to read.
const leadsIn = (section: ConfigSection): Record<Kind, number> => {
	const leads = {
		located: section.number("located", LEAD_MINUTES.located) * MS_PER_MINUTE,
		url: section.number("url", LEAD_MINUTES.url) * MS_PER_MINUTE,
		plain: section.number("plain", LEAD_MINUTES.plain) * MS_PER_MINUTE,
	};

	// Nested blocks are not checked by the runner, which only holds the
	// program's own block to what it read. Without this, `leads: locatd: 1`
	// would be a line that plainly says what the bar should do and silently
	// does nothing.
	section.done();

	return leads;
};

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
	leads: leadsIn(config.section(LEADS_KEY)),
	sound: soundIn(config.section(SOUND_KEY)),
	refreshMs:
		config.number(REFRESH_KEY, DEFAULT_REFRESH_MINUTES) * MS_PER_MINUTE,
	where: config.where,
});

export {
	CALENDARS_KEY,
	DEFAULT_REFRESH_MINUTES,
	DEFAULT_SOUND_LEAD_SECONDS,
	DEFAULT_SOUND_LINGER_SECONDS,
	LEADS_KEY,
	REFRESH_KEY,
	SOUND_KEY,
	eventSettings,
};
export type { EventSettings, SoundSettings };
