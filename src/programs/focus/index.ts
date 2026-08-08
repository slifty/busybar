import {
	DRAW_PRIORITY,
	FRONT_DISPLAY_HEIGHT,
	FRONT_DISPLAY_MIDDLE_X,
	FRONT_DISPLAY_WIDTH,
} from "../../config.ts";
import { MS_PER_SECOND } from "../../constants/time.ts";
import { loadBlocks } from "./blocks.ts";
import { colorFor, nextPhaseChangeAt, phaseAt } from "./focus.ts";
import { createSchedule } from "./schedule.ts";
import type { DrawResult, Program, ProgramContext } from "../../program.ts";
import type { Focus } from "./focus.ts";
import type { Schedule } from "./schedule.ts";

const NAME_ELEMENT_ID = "focus-name";
const COUNTDOWN_ELEMENT_ID = "focus-countdown";

// The name takes the top row in the smallest font, leaving the rest of the
// 16px height to the countdown, which is drawn in a fixed face about ten
// pixels tall. `tiny` is four pixels at its widest glyph, so roughly eighteen
// characters fill the display and anything longer scrolls -- which real block
// names regularly are.
const NAME_FONT = "tiny";
const NAME_Y = 0;
const SCROLL_RATE_PX_PER_MINUTE = 600;
const SCROLL_START_DELAY_MS = 1_000;
const SCROLL_REPEAT_DELAY_MS = 2_000;

// The countdown element takes its target as seconds-based Unix time, in a
// string, and the device ticks it down by itself from there.
//
// Rounded up rather than down, because both uses of this are the moment a
// block ends: a block ending at 10:00:00.750 would otherwise count down to
// zero and take its drawing off screen three quarters of a second early. Being
// a fraction late is harmless by comparison -- the runner wakes on the exact
// millisecond regardless, and the next block's draw replaces these elements.
const unixSeconds = (date: Date): string =>
	String(Math.ceil(date.getTime() / MS_PER_SECOND));

// Resolved once by `start`, before any draw can ask for it.
let schedule: Schedule | undefined = undefined;

const resolvedSchedule = (): Schedule => {
	if (schedule === undefined) {
		throw new Error("the focus schedule was never loaded");
	}

	return schedule;
};

const drawFocus = async (
	{ bar, applicationName }: ProgramContext,
	block: Focus,
	now: Date,
): Promise<DrawResult> => {
	const color = colorFor(phaseAt(block, now));

	// Handing the device the end of the block as an expiry means it takes the
	// drawing down itself, on time, even if this process is not around to do
	// it -- and the built-in clock comes back on its own. The countdown
	// reaching zero and the elements disappearing are then the same instant.
	const displayUntil = unixSeconds(block.end);

	await bar.DisplayDraw({
		application_name: applicationName,
		priority: DRAW_PRIORITY,
		elements: [
			{
				id: NAME_ELEMENT_ID,
				type: "text",
				text: block.name,
				font: NAME_FONT,
				color,
				display: "front",
				align: "top_mid",
				x: FRONT_DISPLAY_MIDDLE_X,
				y: NAME_Y,
				width: FRONT_DISPLAY_WIDTH,
				scroll_rate: SCROLL_RATE_PX_PER_MINUTE,
				scroll_start_delay: SCROLL_START_DELAY_MS,
				scroll_repeat_delay: SCROLL_REPEAT_DELAY_MS,
				display_until: displayUntil,
			},
			{
				id: COUNTDOWN_ELEMENT_ID,
				type: "countdown",
				timestamp: unixSeconds(block.end),
				direction: "time_left",
				show_hours: "when_non_zero",
				color,
				display: "front",
				align: "bottom_mid",
				x: FRONT_DISPLAY_MIDDLE_X,
				y: FRONT_DISPLAY_HEIGHT,
				display_until: displayUntil,
			},
		],
	});

	// Nothing else about this block changes until it does, and the device is
	// counting down without help, so there is no reason to come back sooner.
	return {
		nextDrawInMs: nextPhaseChangeAt(block, now).getTime() - now.getTime(),
	};
};

const start = async (): Promise<void> => {
	schedule = createSchedule(await loadBlocks());
};

const draw = async (context: ProgramContext): Promise<DrawResult> => {
	const now = new Date();
	const active = resolvedSchedule().activeAt(now);

	if (active !== undefined) {
		return await drawFocus(context, active, now);
	}

	// Between blocks there is nothing to draw and nothing to clear: the last
	// block's elements were given its end as their expiry, so the device has
	// already taken them down and handed the screen back.
	const next = resolvedSchedule().nextAfter(now);

	// The schedule is spent. The runner holds the process open, so this is a
	// quiet exit rather than a stopped one.
	if (next === undefined) {
		return {};
	}

	return { nextDrawInMs: next.start.getTime() - now.getTime() };
};

const focus: Program = {
	name: "focus",
	description: "Shows the focus block you are in and how long is left of it",
	start,
	draw,
};

export { focus };
