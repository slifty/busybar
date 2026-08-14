// What `event` reads out of its block of the config file.
//
// The settings are read here and nowhere else, so the answer to "what can this
// program be told to do?" is this file rather than a search for whatever reads
// a value somewhere in the folder.

import type { ConfigSection } from "../../config/section.ts";

const CALENDARS_KEY = "calendars";

interface EventSettings {
	// The appointment calendars to watch, as `https` URLs or paths to `.ics`
	// files. Any number of them: they are read independently and the
	// appointments are pooled, so which feed a given appointment came from
	// stops mattering the moment it is read.
	//
	// An empty list is not an error here. It is the program's own `start` that
	// refuses it, so that the message can say what to do about it.
	readonly calendars: string[];
	// Where a setting is written, so that a message about a feed that could
	// not be read can say which line to go and fix.
	readonly where: (key: string) => string;
}

const eventSettings = (config: ConfigSection): EventSettings => ({
	calendars: config.strings(CALENDARS_KEY),
	where: config.where,
});

export { CALENDARS_KEY, eventSettings };
export type { EventSettings };
