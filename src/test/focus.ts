import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import {
	DEFAULT_DRAW_PRIORITY,
	FRONT_DISPLAY_WIDTH,
} from "../constants/device.ts";
import { focus } from "../programs/focus/index.ts";
import { createFakeBar } from "./bar.ts";
import { sectionOf } from "./config.ts";
import type { BusyBar } from "@busy-app/busy-lib";
import type { ProgramContext } from "../program.ts";
import type { Focus } from "../programs/focus/focus.ts";

// The tooling the `focus` suites need: a block to reason about, schedules to
// read, a context to draw with, and a way to ask what ended up on the display.
//
// It was written inline in the suite about what a block draws, which is where
// it stopped fitting. That file sits at the limit on its length, and the
// harness in it -- a temporary directory, a schedule written into it, a
// context pointed at that -- is the same harness any other suite about this
// program would have to write out again for itself.
//
// Two of them do now: one about what a block says, one about the line under
// the countdown.

const DEFAULT_START = new Date("2026-01-01T09:00:00Z");
const DEFAULT_END = new Date("2026-01-01T10:00:00Z");

// Builds a focus block, letting a test name only the parts it cares about.
const createFocus = (overrides: Partial<Focus> = {}): Focus => ({
	name: "Deep Work",
	start: DEFAULT_START,
	end: DEFAULT_END,
	...overrides,
});

// The one block every drawing suite works from, as instants rather than as a
// block: what goes in a schedule file is text, and what a test asserts about
// is usually a moment inside it.
const BLOCK_START = DEFAULT_START;
const BLOCK_END = DEFAULT_END;

type Elements = Parameters<BusyBar["DisplayDraw"]>[0]["elements"];
type Element = Elements[number];
type Rectangle = Extract<Element, { type: "rectangle" }>;

const isText = (
	element: Element,
): element is Extract<Element, { type: "text" }> => element.type === "text";

const isCountdown = (
	element: Element,
): element is Extract<Element, { type: "countdown" }> =>
	element.type === "countdown";

const isRectangle = (element: Element): element is Rectangle =>
	element.type === "rectangle";

// The display's own frame: the only rectangle as wide as the display, and the
// only one that is an outline rather than a solid.
const frameOf = (elements: Elements): Rectangle | undefined =>
	elements
		.filter(isRectangle)
		.find(({ width }) => width === FRONT_DISPLAY_WIDTH);

// The filled rectangles, in the order they were sent.
//
// The order is what a caller has to pick them out by. The segments of the line
// under the clock lie on top of one another, so no two of them can be told
// apart by where they are -- at the ends of a block two are the same width,
// and at every moment two start at the same column. Colour would do it, but
// then every colour the program draws would be something a selector depends
// on, and a colour turned up or down would take the suite out before any
// assertion about it ran. The order is load-bearing on the device anyway,
// which is what makes it the honest thing to index by.
const solidsOf = (elements: Elements): Rectangle[] =>
	elements.filter(isRectangle).filter(({ fill }) => fill === "solid");

// The name is drawn as one element per line, so what it says is the lines put
// back together.
const drawnName = (elements: Elements): string =>
	elements
		.filter(isText)
		.map(({ text }) => text)
		.join(" ")
		.trim();

interface Schedules {
	// A path in the directory that nothing has written yet, for a suite that
	// means to rewrite a schedule underneath the program.
	readonly path: () => string;
	// Writes one and hands back the path, without starting anything.
	readonly write: (blocks: unknown, path?: string) => Promise<string>;
	// Writes one and runs the program's one-time preparation against it, which
	// is what every drawing test needs before it can draw.
	readonly start: (blocks: unknown, path?: string) => Promise<ProgramContext>;
	readonly forget: () => Promise<void>;
}

// Somewhere to write schedules that is not where the real one lives.
//
// A real temporary directory rather than a mocked `fs`, because reading the
// file is part of what a draw does -- and never `local/`, since an invented
// schedule sitting where the real one lives is one glance away from being
// believed.
const createSchedules = (): Schedules => {
	const directory = mkdtempSync(join(tmpdir(), "busybar-focus-test-"));

	// A file of its own per test, so one rewriting its schedule cannot disturb
	// another.
	const path = (): string =>
		join(directory, `${String(Math.random()).slice(2)}.json`);

	const write = async (
		blocks: unknown,
		at: string = path(),
	): Promise<string> => {
		await writeFile(at, JSON.stringify(blocks), "utf8");

		return at;
	};

	return {
		path,
		write,
		start: async (blocks, at) => {
			const { bar } = createFakeBar();
			const context = {
				bar,
				applicationName: focus.name,
				priority: DEFAULT_DRAW_PRIORITY,
				config: sectionOf({ file: await write(blocks, at) }),
				log: () => {
					// Nothing here cares what the program had to say.
				},
				// `focus` never asks for either: it is the program being
				// interrupted rather than the one interrupting, and the runner
				// is what wakes it.
				redraw: () => undefined,
				releaseScreen: () => undefined,
			};

			await focus.start?.(context);

			return context;
		},
		forget: async () => {
			await rm(directory, { recursive: true, force: true });
		},
	};
};

// A drawing, and the moment the program chose to make it.
interface Frame {
	readonly at: Date;
	readonly elements: Elements;
}

// However many wake-ups a walk will follow before giving up. Well above what
// any real block asks for, so a walk that hits it is a program asking to be
// drawn again immediately rather than a block with a lot going on.
const WAKE_UP_LIMIT = 100;

// Walks the program forward through the wake-ups it asks for, up to `until`,
// and gives back what it drew at each of them.
//
// A draw only says when it wants the next one, so this is the only way to see
// a sequence. The bar draining a pixel at a time, and the reflow when the
// countdown drops its hours, are properties of a whole block rather than of
// any one draw.
const walkTo = async (
	context: ProgramContext,
	until: Date,
): Promise<Frame[]> => {
	const frames: Frame[] = [];

	for (let count = 0; count < WAKE_UP_LIMIT; count += 1) {
		const at = new Date();

		if (at.getTime() > until.getTime()) {
			break;
		}

		const fake = createFakeBar();
		// eslint-disable-next-line no-await-in-loop -- a draw is what says when the next one is
		const { nextDrawInMs } = await focus.draw({ ...context, bar: fake.bar });
		const { draws } = fake;
		const [drawn] = draws;

		if (drawn === undefined || nextDrawInMs === undefined) {
			break;
		}

		frames.push({ at, elements: drawn.elements });
		vi.setSystemTime(new Date(at.getTime() + nextDrawInMs));
	}

	return frames;
};

export {
	BLOCK_END,
	BLOCK_START,
	WAKE_UP_LIMIT,
	createFocus,
	createSchedules,
	drawnName,
	frameOf,
	isCountdown,
	isRectangle,
	isText,
	solidsOf,
	walkTo,
};
export type { Element, Elements, Frame, Rectangle, Schedules };
