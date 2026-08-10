import {
	DRAW_PRIORITY,
	FRONT_DISPLAY_HEIGHT,
	FRONT_DISPLAY_MIDDLE_X,
	FRONT_DISPLAY_WIDTH,
} from "../../config.ts";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../../constants/time.ts";
import { loadBlocks } from "./blocks.ts";
import { colorFor, nextPhaseChangeAt, phaseAt } from "./focus.ts";
import { createSchedule } from "./schedule.ts";
import type { DrawResult, Program, ProgramContext } from "../../program.ts";
import type { Focus } from "./focus.ts";

const NAME_ELEMENT_ID = "focus-name";
const COUNTDOWN_ELEMENT_ID = "focus-countdown";

// How long the program will go without looking at the schedule again while it
// has nothing on screen.
//
// The schedule is written by something else and changes on its own, so waiting
// only for the next block we can currently see would miss one added ahead of
// it -- and, on a schedule that has run out, would mean never looking again at
// all. This is a floor on curiosity, not a poll: it applies only between
// blocks, where a wake-up costs a file read and nothing else.
//
// It deliberately does not apply while a block is on screen. Cutting that wait
// short would redraw the block, and redrawing restarts the scroll on its name.
const IDLE_REFRESH_MINUTES = 15;
const IDLE_REFRESH_MS = IDLE_REFRESH_MINUTES * MS_PER_MINUTE;

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

// Reading the schedule here is a check, not a cache. `draw` reads it again
// every time; what this buys is that a missing or malformed file stops the
// tool now, with the reason, rather than being retried every few seconds
// behind a bar that sits dark.
const start = async (): Promise<void> => {
	await loadBlocks();
};

const draw = async (context: ProgramContext): Promise<DrawResult> => {
	const now = new Date();

	// Read afresh on every draw rather than resolved once at startup. The file
	// belongs to whatever is filling it in -- a calendar sync, an editor -- and
	// a schedule read only at startup would have this process showing
	// yesterday's blocks for as long as it stayed up.
	const schedule = createSchedule(await loadBlocks());
	const active = schedule.activeAt(now);

	if (active !== undefined) {
		return await drawFocus(context, active, now);
	}

	// Between blocks there is nothing to draw and nothing to clear: the last
	// block's elements were given its end as their expiry, so the device has
	// already taken them down and handed the screen back.
	//
	// An exhausted schedule is not a reason to stop. It much more often means
	// the file has not been filled in yet than that the day is genuinely over,
	// and a program that gave up here would stay given up until restarted.
	const next = schedule.nextAfter(now);
	const untilNextBlock =
		next === undefined ? Infinity : next.start.getTime() - now.getTime();

	return { nextDrawInMs: Math.min(untilNextBlock, IDLE_REFRESH_MS) };
};

const focus: Program = {
	name: "focus",
	description: "Shows the focus block you are in and how long is left of it",
	start,
	draw,
};

export { IDLE_REFRESH_MS, focus };
