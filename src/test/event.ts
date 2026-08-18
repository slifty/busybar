import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MS_PER_SECOND } from "../constants/time.ts";
import { ALERT_PRIORITY, event } from "../programs/event/index.ts";
import { sectionOf } from "./config.ts";
import type { BusyBar } from "@busy-app/busy-lib";
import type { ProgramContext } from "../program.ts";
import type { FakeBar } from "./bar.ts";

// The tooling the `event` suites need: calendars to read, a context to draw
// with, and a way to ask what ended up on the display.
//
// Two suites want all of it -- one about what the program draws, one about the
// noise it makes and how a press stops it -- which is what makes it tooling
// rather than a fixture belonging to either.

type Elements = Parameters<BusyBar["DisplayDraw"]>[0]["elements"];
type Element = Elements[number];
type TextElement = Extract<Element, { type: "text" }>;

const isText = (element: Element): element is TextElement =>
	element.type === "text";

const isCountdown = (
	element: Element,
): element is Extract<Element, { type: "countdown" }> =>
	element.type === "countdown";

const isRectangle = (
	element: Element,
): element is Extract<Element, { type: "rectangle" }> =>
	element.type === "rectangle";

// The name is drawn as one element per line, so what it says is the lines put
// back together.
//
// Selected by id rather than by being text, because the caption under the name
// is text too -- and a helper that swept it up would have every assertion about
// the name quietly also asserting the caption.
const NAME_ID_PREFIX = "event-name";
const STARTS_IN_ID = "event-starts-in";

const drawnName = (elements: Elements): string =>
	elements
		.filter(isText)
		.filter(({ id }) => id.startsWith(NAME_ID_PREFIX))
		.map(({ text }) => text)
		.join(" ")
		.trim();

const nameLines = (elements: Elements): TextElement[] =>
	elements.filter(isText).filter(({ id }) => id.startsWith(NAME_ID_PREFIX));

const caption = (elements: Elements): TextElement | undefined =>
	elements.filter(isText).find(({ id }) => id === STARTS_IN_ID);

// Which stock sounds the bar was asked to play.
//
// The device takes either a path inside an application's own assets or the name
// of one it ships, and the two are a union -- so a suite asserting that the
// firmware's own chime was played has to say which of the two it is looking at.
const stockSoundsPlayed = ({ plays }: FakeBar): string[] =>
	plays.flatMap((play) => ("stock_path" in play ? [play.stock_path] : []));

const unixSeconds = (date: Date): string =>
	String(Math.ceil(date.getTime() / MS_PER_SECOND));

// A calendar entry with a time on it, which is the only kind this program has
// anything to say about.
const timedEvent = (
	uid: string,
	summary: string,
	start: string,
	extra: string[] = [],
): string[] => [
	"BEGIN:VEVENT",
	`UID:${uid}@busybar.test`,
	`DTSTART:${start}`,
	...extra,
	`SUMMARY:${summary}`,
	"END:VEVENT",
];

interface Calendars {
	// Writes one, and hands back the path to point a setting at.
	readonly write: (name: string, ...body: string[]) => Promise<string>;
	// A path in the same directory that was never written, for a feed that
	// cannot be read.
	readonly missing: (name: string) => string;
	readonly forget: () => Promise<void>;
}

// Somewhere to write calendars that is not where the real ones live.
//
// A real temporary directory rather than a mocked `fs`, for the same reason the
// focus suites use one: reading a source is most of the job, so faking it would
// leave the part worth testing untested. Never `local/`, because an invented
// calendar sitting where a real one lives is one glance away from being
// believed.
const createCalendars = (): Calendars => {
	const directory = mkdtempSync(join(tmpdir(), "busybar-event-test-"));

	return {
		write: async (name, ...body) => {
			const path = join(directory, name);

			await writeFile(
				path,
				[
					"BEGIN:VCALENDAR",
					"VERSION:2.0",
					"PRODID:-//busybar//test//EN",
					...body,
					"END:VCALENDAR",
				].join("\r\n"),
				"utf8",
			);

			return path;
		},
		missing: (name) => join(directory, name),
		forget: async () => {
			await rm(directory, { recursive: true, force: true });
		},
	};
};

// What a program did besides draw: asked to be redrawn, or said it had let the
// screen go. Both are calls out to the runner, so a suite that wants to assert
// on them has to be handed somewhere for them to land.
interface Signals {
	readonly redraws: () => number;
	readonly releases: () => number;
}

const contextFor = (
	fake: FakeBar,
	calendars: string[],
	settings: Record<string, unknown> = {},
	signals?: Signals & { readonly record: (of: "redraw" | "release") => void },
): ProgramContext => ({
	bar: fake.bar,
	config: sectionOf({ calendars, ...settings }),
	applicationName: event.name,
	priority: ALERT_PRIORITY,
	log: () => undefined,
	redraw: () => {
		signals?.record("redraw");
	},
	releaseScreen: () => {
		signals?.record("release");
	},
});

// Somewhere for those calls to be counted.
const createSignals = (): Signals & {
	readonly record: (of: "redraw" | "release") => void;
} => {
	const counts = { redraw: 0, release: 0 };

	return {
		record: (of) => {
			counts[of] += 1;
		},
		redraws: () => counts.redraw,
		releases: () => counts.release,
	};
};

// A context for a program that has been started.
//
// The program remembers what it has on screen and what has been acknowledged,
// because a press has to be able to answer the alert you are looking at and
// nothing hands the handler what that is. `start` clears both, so a suite about
// the button begins a run rather than drawing into whatever the last test left
// behind.
const startedContext = async (
	fake: FakeBar,
	calendars: string[],
	settings: Record<string, unknown> = {},
): Promise<ProgramContext> => {
	const context = contextFor(fake, calendars, settings);

	await event.start?.(context);

	return context;
};

export {
	caption,
	contextFor,
	createCalendars,
	createSignals,
	drawnName,
	isCountdown,
	isRectangle,
	isText,
	nameLines,
	startedContext,
	stockSoundsPlayed,
	timedEvent,
	unixSeconds,
};
export type { Calendars, Element, Elements, Signals, TextElement };
