import {
	FRONT_DISPLAY_HEIGHT,
	FRONT_DISPLAY_WIDTH,
} from "../../constants/device.ts";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../../constants/time.ts";
import { COUNTDOWN_METRICS } from "../../fonts.ts";
import { fitText, maxLinesIn } from "../../text.ts";
import { loadBlocks, mirrorBlocks } from "./blocks.ts";
import { colorFor, nextPhaseChangeAt, phaseAt } from "./focus.ts";
import { createSchedule } from "./schedule.ts";
import { focusSettings } from "./settings.ts";
import type { DrawResult, Program, ProgramContext } from "../../program.ts";
import type { Region } from "../../text.ts";
import type { Focus } from "./focus.ts";

const BORDER_ELEMENT_ID = "focus-border";
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
const IDLE_REFRESH_MINUTES = 15;
const IDLE_REFRESH_MS = IDLE_REFRESH_MINUTES * MS_PER_MINUTE;

// The block is drawn as two columns inside a coloured frame: what you are
// doing on the left, how long is left of it on the right.
//
// The colour is the frame and the countdown; the name is always white. On an
// LED matrix a phase colour applied to the text costs legibility exactly when
// the text is what you are trying to read, and orange text at wind-down is the
// worst of the three. Moving the colour to a border keeps the signal -- the
// whole bar changes colour, visible from further away than the words are --
// without ever dimming what it is saying.
//
// Square corners. The device's `radius` does not round a one pixel outline so
// much as thicken its corners -- at 2 it adds a pixel to each side of every
// corner, and only at 3 does it start cutting them, by which point it has
// taken three pixels off a display sixteen tall. Sharp is both cleaner and
// cheaper here.
const BORDER_THICKNESS = 1;
const BORDER_RADIUS = 0;

// Two pixels between the frame and anything inside it, on every side, and two
// between the two columns so the name does not run into the clock.
//
// This is the expensive constant on the page. Four of the sixteen rows go to
// the frame and its padding, leaving ten for text, which is less than two
// lines of `small` can occupy however the words fall -- so a name that needs a
// second line gets `tiny`, and a name on one line gets `large` only when it
// has no descender. What is bought is that the frame reads as a frame from
// across the room rather than as a box the letters are jammed into.
const PADDING = 2;
const COLUMN_GAP = 2;

// A frame and its padding are paid for twice on each axis, once at each edge.
const EDGES = 2;

// The rightmost column of a region is one short of its width.
const LAST_PIXEL = 1;

// Halving what is left over puts the same amount on each side.
const SIDES = 2;

const CONTENT_TOP = BORDER_THICKNESS + PADDING;
const CONTENT_HEIGHT =
	FRONT_DISPLAY_HEIGHT - EDGES * (BORDER_THICKNESS + PADDING);
const CONTENT_LEFT = BORDER_THICKNESS + PADDING;
const CONTENT_WIDTH =
	FRONT_DISPLAY_WIDTH - EDGES * (BORDER_THICKNESS + PADDING);
const CONTENT_RIGHT = CONTENT_LEFT + CONTENT_WIDTH - LAST_PIXEL;

// The countdown is monospaced and comes in exactly two widths: seventeen
// pixels as MM:SS, twenty-seven once the hours are showing. The hours are
// asked for on every block, so the column is the wide one always.
//
// The device would otherwise drop the hours at the hour mark and take ten
// pixels with them, which is ten pixels the name could have back -- and the
// whole layout would have to move to collect them, at an instant our clock and
// the device's have to agree on to the tick. So a block over an hour was drawn
// one way and the same block drawn another way an hour from its end, with only
// the longer ones ever showing the second layout at all.
//
// Fixing the column costs the name those ten pixels on every block and buys a
// display where nothing moves: no reflow, and no leading "0:" appearing and
// disappearing partway through. What is on screen is then also what every
// block was drawn with, rather than what the short ones happen to get.
const { widthWithHours: COUNTDOWN_WIDTH } = COUNTDOWN_METRICS;

// The countdown sits against the right edge of the content area, centred on
// the height of its own ink.
//
// Rounded up for the same reason the text is: five rows of digits in ten
// leaves one over, and it goes above.
const COUNTDOWN_Y =
	CONTENT_TOP +
	Math.ceil((CONTENT_HEIGHT - COUNTDOWN_METRICS.inkHeight) / SIDES) -
	COUNTDOWN_METRICS.inkTop;

// One of the two padding rows is lent to descenders, and only to descenders.
//
// Without it there is no room to centre in: a font whose ink is nine rows deep
// in a ten row box has its tail against the bottom, so a name carrying one
// gets pushed back up and sits a row above a name that does not. Lending the
// row keeps every name on the same line and still leaves a clear row between
// the longest tail and the frame.
const TAIL_ROOM = 1;

const nameRegion = (): Region => ({
	width: CONTENT_WIDTH - COLUMN_GAP - COUNTDOWN_WIDTH,
	height: CONTENT_HEIGHT,
	tailRoom: TAIL_ROOM,
});

// Every line of the name gets an element, and the same number of elements go
// out on every draw whether or not there is text for them.
//
// Element ids persist on the device until they expire or are drawn over, so a
// block that reflowed from two lines to one -- which happens the moment the
// countdown narrows -- would otherwise leave its second line stranded on
// screen. Unused slots are drawn as a single space, which is valid text and no
// ink at all.
const NAME_LINE_SLOTS = maxLinesIn(CONTENT_HEIGHT);
const BLANK_LINE = { text: " ", y: 0 };

// The name is never a phase colour. See BORDER_THICKNESS above.
const NAME_COLOR = "#FFFFFFFF";

// The frame carries the colour, so it is drawn as an outline and nothing else.
// A fill colour is still required by the generated types even where there is
// no fill to apply.
const NO_FILL_COLORS = ["#00000000"];

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
	{ bar, applicationName, priority }: ProgramContext,
	block: Focus,
	now: Date,
): Promise<DrawResult> => {
	const color = colorFor(phaseAt(block, now));

	// Handing the device the end of the block as an expiry means it takes the
	// drawing down itself, on time, even if this process is not around to do
	// it -- and the built-in clock comes back on its own. The countdown
	// reaching zero and the elements disappearing are then the same instant.
	const displayUntil = unixSeconds(block.end);

	const region = nameRegion();
	const { font, lines: fitted } = fitText(block.name, region);
	const nameCenterX = CONTENT_LEFT + Math.floor(region.width / SIDES);

	const lines = Array.from({ length: NAME_LINE_SLOTS }, (_unused, index) => {
		const { [index]: line = BLANK_LINE } = fitted;

		return { id: `${NAME_ELEMENT_ID}-${String(index)}`, line };
	});

	await bar.DisplayDraw({
		application_name: applicationName,
		priority,
		elements: [
			{
				id: BORDER_ELEMENT_ID,
				type: "rectangle",
				x: 0,
				y: 0,
				width: FRONT_DISPLAY_WIDTH,
				height: FRONT_DISPLAY_HEIGHT,
				radius: BORDER_RADIUS,
				fill: "none",
				fill_colors: NO_FILL_COLORS,
				border_width: BORDER_THICKNESS,
				border_color: color,
				display: "front",
				align: "top_left",
				display_until: displayUntil,
			},
			...lines.map(({ id, line }) => ({
				id,
				type: "text" as const,
				text: line.text,
				font,
				color: NAME_COLOR,
				display: "front" as const,
				align: "top_mid" as const,
				x: nameCenterX,
				y: CONTENT_TOP + line.y,
				display_until: displayUntil,
			})),
			{
				id: COUNTDOWN_ELEMENT_ID,
				type: "countdown",
				timestamp: unixSeconds(block.end),
				direction: "time_left",
				show_hours: "always",
				color,
				display: "front",
				align: "top_right",
				// The element's box runs two pixels past its last digit, so
				// the anchor goes that far beyond where the ink should end.
				x: CONTENT_RIGHT + COUNTDOWN_METRICS.inkRight,
				y: COUNTDOWN_Y,
				display_until: displayUntil,
			},
		],
	});

	// The colour is the only thing about this block that changes on its own.
	// The clock is a fixed width and the device ticks it down itself, so there
	// is no instant at which what is on screen has to be rearranged -- and
	// nothing here has to agree with the device's own clock about when such an
	// instant falls.
	return {
		nextDrawInMs: nextPhaseChangeAt(block, now).getTime() - now.getTime(),
	};
};

// Reading the schedule here is a check, not a cache. `draw` reads it again
// every time; what this buys is that a missing or malformed file stops the
// tool now, with the reason, rather than being retried every few seconds
// behind a bar that sits dark.
//
// What it is read for a second time is the JSON file, which is rewritten from
// the calendar whenever there is a calendar to rewrite it from. Nothing reads
// that file while a calendar is set, so this is for the person looking at it:
// a schedule file left saying something the bar has not shown for weeks is the
// first thing anyone would check and the last thing they should trust.
const start = async ({ config, log }: ProgramContext): Promise<void> => {
	const settings = focusSettings(config);

	await mirrorBlocks(settings, await loadBlocks(settings), log);
};

const draw = async (context: ProgramContext): Promise<DrawResult> => {
	const now = new Date();

	// The settings are taken from the block again rather than held from
	// `start`, which costs nothing -- the file was read once, at startup, and
	// this is a handful of keys out of what it said.
	const settings = focusSettings(context.config);

	// Read afresh on every draw rather than resolved once at startup. The file
	// belongs to whatever is filling it in -- a calendar sync, an editor -- and
	// a schedule read only at startup would have this process showing
	// yesterday's blocks for as long as it stayed up.
	const schedule = createSchedule(await loadBlocks(settings));
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
