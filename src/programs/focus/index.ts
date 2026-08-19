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
const PROGRESS_PAST_ELEMENT_ID = "focus-progress";
const PROGRESS_AHEAD_ELEMENT_ID = "focus-progress-fill";
const PROGRESS_NOW_ELEMENT_ID = "focus-progress-now";

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

// Two pixels between the frame and anything inside it, and two between the two
// columns so the name does not run into the clock.
//
// On every side but the top, where the text is lifted a row -- see TEXT_LIFT.
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

// The text sits a row higher than even padding would put it, both columns of
// it, and the row comes off the top rather than the bottom.
//
// Even padding centres the text on the display, which is right for a display
// holding nothing but text. The line has spoken for the bottom of this one,
// and the row moved off the top is what makes the space it sits in an even
// number of rows -- so it can be centred there with the same clearance above
// it as below. The whole of what it costs is a pixel of headroom on the
// tallest names.
const TEXT_LIFT = 1;

// Both columns are measured from here, so lifting it lifts the name and the
// clock together. What sits below it is no longer symmetrical with what sits
// above -- CONTENT_HEIGHT is still the room even padding would leave, because
// that is what the name is sized to, and the line sits below the bottom of it
// in the other column.
const CONTENT_TOP = BORDER_THICKNESS + PADDING - TEXT_LIFT;
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
// the device's have to agree on to the tick. Fixing the column costs the name
// those ten pixels on every block and buys a display where nothing moves: no
// reflow, no bar shifting under a clock that changed width, and no leading "0:"
// appearing and disappearing an hour from the end.
const { widthWithHours: COUNTDOWN_WIDTH } = COUNTDOWN_METRICS;

// Where the countdown's left edge falls. Its ink is anchored to the right of
// the content area, and the width no longer changes, so this is fixed.
const COUNTDOWN_LEFT = CONTENT_RIGHT + LAST_PIXEL - COUNTDOWN_WIDTH;

// Under the countdown, a line saying as a proportion what the countdown says
// as a number: how much of the block is left.
//
// Both are worth having. "0:44:59" is exact and says nothing about whether that
// is most of the block or the tail of it -- which is the question you are
// actually asking when you glance up, and the one thing a countdown cannot
// answer, since it does not know when the block began.
//
// The whole of it is drawn: the line is the block, end to end, and where you
// are in it is a change of brightness rather than a change of length. To the
// left of now is dim, to the right is bright, and now itself is the phase
// colour. So the ink is always the time you still have, the dark end is what
// you have spent, and the coloured pixel between them walks the length of the
// line as the block runs.
//
// A frame around it would say the same thing the ends of the line already say,
// and cost two of the sixteen rows to say it. One row is the whole of it.
const PROGRESS_HEIGHT = 1;

// Exactly the countdown's width, sitting directly under it. The two are one
// reading of one thing, and a line narrower than the clock above it would look
// like a measurement of something else.
const PROGRESS_WIDTH = COUNTDOWN_WIDTH;

// Every pixel of it counts, there being no frame to sit inside -- and it counts
// in whole pixels, which is all the resolution there is to spend.
const PROGRESS_STEPS = PROGRESS_WIDTH;

// Where the line stops being what is behind you and starts being what is
// ahead: the leftmost pixel of the time still to come, which is now.
const progressNowLeft = (filled: number): number =>
	COUNTDOWN_LEFT + PROGRESS_STEPS - filled;

// The countdown sits against the right edge of the content area, centred on
// the height of its own ink -- as though the bar were not there at all. The
// content area itself is lifted to make room for the bar; the clock is not
// moved within it.
//
// Rounded up for the same reason the text is: five rows of digits in ten
// leaves one over, and it goes above.
//
// Centring the digits and the bar together as one block would be the obvious
// thing and is the wrong one. It moves the clock off the line the name is
// centred on, to make room for something that is a second opinion about the
// same quantity -- and a second opinion does not get to move the first.
const COUNTDOWN_Y =
	CONTENT_TOP +
	Math.ceil((CONTENT_HEIGHT - COUNTDOWN_METRICS.inkHeight) / SIDES) -
	COUNTDOWN_METRICS.inkTop;

// One clear row under the digits, and everything left over falls between the
// line and the frame below it.
//
// It sits with the clock rather than centred in the space, because it belongs
// to the clock: the two are one reading of one thing. What it must not do is
// touch either neighbour. Digits resting on it would read as underlined, and
// the line is not an underline -- and the frame is a solid line in the phase
// colour, which is also the colour of the pixel marking now, so the two
// merging would put a false now at the bottom of the display.
//
// Of the two, the frame is the one worth the extra distance: the digits above
// are broken and mostly white, where the frame is solid and the same colour.
const PROGRESS_GAP = 1;
const DIGITS_END =
	COUNTDOWN_Y + COUNTDOWN_METRICS.inkTop + COUNTDOWN_METRICS.inkHeight;
const PROGRESS_Y = DIGITS_END + PROGRESS_GAP;

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

// The time still ahead of you is white for the reason the name is. See
// BORDER_THICKNESS.
const PROGRESS_AHEAD_COLOR = "#FFFFFFFF";

// Now is one pixel, and it is the only place on the line the phase colour
// appears -- which is what makes it findable at a glance rather than something
// you have to measure the line to locate.
const PROGRESS_NOW_WIDTH = 1;

// How brightly the part of the line you have already spent is drawn, as a
// percentage of the part still ahead of you.
//
// Dim rather than dark, because it is still saying something: it is what makes
// the line's left end visible, and so what the bright part is a proportion of.
// Turned right off, a block just begun and a block half over would both be a
// bar of ink with nothing to measure it against.
//
// This is the number to turn if it wants tuning against the real display.
const PAST_BRIGHTNESS = 25;

const FULL_BRIGHTNESS = 100;
const HEX = 16;
const CHANNEL_DIGITS = 2;
const COLOR_CHANNELS = 3;
const PAST_HASH = 1;

// The same colour, dimmer.
//
// The three colour channels are scaled and the alpha is left exactly as it
// was. Alpha is compositing -- how much of what is behind an element shows
// through it -- and behind an element here there is nothing but an unlit
// pixel, so what the firmware makes of a partial alpha is its own business and
// not something measured. Scaling the channels asks for a darker colour, which
// is a thing every renderer agrees about.
const dimmed = (color: string, brightness: number): string => {
	const channels = Array.from({ length: COLOR_CHANNELS }, (_unused, index) => {
		const at = PAST_HASH + index * CHANNEL_DIGITS;
		const value = Number.parseInt(color.slice(at, at + CHANNEL_DIGITS), HEX);

		return Math.round((value * brightness) / FULL_BRIGHTNESS)
			.toString(HEX)
			.padStart(CHANNEL_DIGITS, "0");
	});

	return `#${channels.join("")}${color.slice(PAST_HASH + COLOR_CHANNELS * CHANNEL_DIGITS)}`.toUpperCase();
};

// The fill is the inside of the bar and nothing else: the frame around it is a
// separate element, drawn at the full width the fill is measured against. A
// border colour is still required by the generated types even where there is
// no border to draw.
const NO_BORDER_WIDTH = 0;
const NO_BORDER_COLOR = "#00000000";

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

// How much of the bar is still filled, in pixels of its interior.
//
// Rounded up, so the bar keeps a pixel for as long as the block is running. A
// bar that emptied while the clock beside it still read 0:20 would be wrong
// about the only thing it is there to say, and rounding the other way is wrong
// for a twenty-fifth of every block rather than never. What it costs is that
// the last pixel stands for that twenty-fifth -- which is the direction to err
// in, since the exact figure is already on screen next to it.
//
// Multiplied before it is divided, which is not a style choice. Every one of
// these is a whole number of milliseconds, so this way a time left that is
// exactly some number of pixels' worth divides to exactly that number --
// where dividing first goes through a fraction that is not representable and
// can land a hair above the integer, which rounds up to a pixel that has
// already gone. That is not a cosmetic error: the program wakes on those exact
// instants, so a draw made there would report the pixel it had just lost as
// still present, find its next change already behind it, and fall through to
// the next colour change instead -- leaving the bar frozen for as long as that
// took.
//
// Only ever asked about the block being drawn, which is the one covering now,
// so the time left is in (0, total] and the answer is between one pixel and a
// full bar.
const filledSteps = (block: Focus, now: Date): number => {
	const total = block.end.getTime() - block.start.getTime();
	const remaining = block.end.getTime() - now.getTime();

	return Math.ceil((remaining * PROGRESS_STEPS) / total);
};

// The bar goes out a pixel at a time, so what there is ever to wait for is the
// next one going.
const ONE_STEP = 1;

// When the bar will be a pixel shorter than it is now.
//
// This is the one part of the drawing the device cannot keep for itself. The
// countdown ticks on its own and the frame does not change, but a bar draining
// over an hour is fifteen draws, at the fifteen instants a pixel is actually
// due to go -- which is still nothing beside redrawing on a timer to find out
// whether one has.
const nextFillChangeAt = (block: Focus, now: Date): Date => {
	const total = block.end.getTime() - block.start.getTime();
	const after = filledSteps(block, now) - ONE_STEP;

	// Multiplied before it is divided for the reason above, so that this
	// instant and the count `filledSteps` reports at it are the same
	// arithmetic and cannot disagree.
	//
	// Rounded up to a whole millisecond, so the wake-up lands after the pixel
	// has gone rather than a fraction before it. Waking early would redraw the
	// same bar and ask to be woken again immediately, which is a loop rather
	// than a wasted request.
	return new Date(
		Math.ceil(block.end.getTime() - (after * total) / PROGRESS_STEPS),
	);
};

// The two moments the drawing has to be made again: when the phase colour
// changes, and when the bar loses a pixel.
//
// Nothing about the layout is a third. The clock is a fixed width and the
// device ticks it down itself, so there is no instant at which what is on
// screen has to be rearranged -- which also means nothing here has to agree
// with the device's own clock about when such an instant falls.
//
// The phase change is both a candidate and the bound: on the last pixel the
// next one falls at the end of the block, and past the end of the phase there
// is a draw coming anyway.
const nextChangeAt = (block: Focus, now: Date): Date => {
	const fillChange = nextFillChangeAt(block, now);
	const phaseChange = nextPhaseChangeAt(block, now);

	return fillChange.getTime() > now.getTime() &&
		fillChange.getTime() < phaseChange.getTime()
		? fillChange
		: phaseChange;
};

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
	const filled = filledSteps(block, now);
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
			// The three lie on top of one another rather than beside one
			// another, and they are sent in the order they are meant to be
			// seen in: the whole line dim, the part still ahead over the right
			// of it, and now over the pixel where the two meet.
			//
			// Laid end to end instead, each would be a length that reaches
			// zero -- no time spent at the start of a block, none left at the
			// end -- and an element of no width is a thing this device has
			// never been asked for. Overlapping, every one of them is a
			// rectangle with something in it, at every moment of every block.
			{
				id: PROGRESS_PAST_ELEMENT_ID,
				type: "rectangle",
				x: COUNTDOWN_LEFT,
				y: PROGRESS_Y,
				width: PROGRESS_WIDTH,
				height: PROGRESS_HEIGHT,
				radius: BORDER_RADIUS,
				fill: "solid",
				fill_colors: [dimmed(PROGRESS_AHEAD_COLOR, PAST_BRIGHTNESS)],
				border_width: NO_BORDER_WIDTH,
				border_color: NO_BORDER_COLOR,
				display: "front",
				align: "top_left",
				display_until: displayUntil,
			},
			{
				id: PROGRESS_AHEAD_ELEMENT_ID,
				type: "rectangle",
				x: progressNowLeft(filled),
				y: PROGRESS_Y,
				width: filled,
				height: PROGRESS_HEIGHT,
				radius: BORDER_RADIUS,
				fill: "solid",
				fill_colors: [PROGRESS_AHEAD_COLOR],
				border_width: NO_BORDER_WIDTH,
				border_color: NO_BORDER_COLOR,
				display: "front",
				align: "top_left",
				display_until: displayUntil,
			},
			{
				id: PROGRESS_NOW_ELEMENT_ID,
				type: "rectangle",
				x: progressNowLeft(filled),
				y: PROGRESS_Y,
				width: PROGRESS_NOW_WIDTH,
				height: PROGRESS_HEIGHT,
				radius: BORDER_RADIUS,
				fill: "solid",
				fill_colors: [color],
				border_width: NO_BORDER_WIDTH,
				border_color: NO_BORDER_COLOR,
				display: "front",
				align: "top_left",
				display_until: displayUntil,
			},
		],
	});

	// Nothing else about this block changes until it does, and the device is
	// counting down without help, so there is no reason to come back sooner.
	return {
		nextDrawInMs: nextChangeAt(block, now).getTime() - now.getTime(),
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
