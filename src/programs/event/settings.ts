// What `event` reads out of its block of the config file.
//
// The settings are read here and nowhere else, so the answer to "what can this
// program be told to do?" is this file rather than a search for whatever reads
// a value somewhere in the folder.

import { MS_PER_MINUTE } from "../../constants/time.ts";
import { LEAD_MINUTES } from "./appointment.ts";
import type { ConfigSection } from "../../config/section.ts";
import type { Kind } from "./appointment.ts";

const CALENDARS_KEY = "calendars";
const LEADS_KEY = "leads";
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

const eventSettings = (config: ConfigSection): EventSettings => ({
	calendars: config.strings(CALENDARS_KEY),
	leads: leadsIn(config.section(LEADS_KEY)),
	where: config.where,
});

export { CALENDARS_KEY, LEADS_KEY, eventSettings };
export type { EventSettings };
