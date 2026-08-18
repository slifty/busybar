import {
	BUSY_SESSION_PRIORITY,
	FRONT_DISPLAY_HEIGHT,
	FRONT_DISPLAY_WIDTH,
} from "../../constants/device.ts";
import {
	MS_PER_HOUR,
	MS_PER_MINUTE,
	MS_PER_SECOND,
} from "../../constants/time.ts";
import { COUNTDOWN_METRICS, FONT_METRICS, widthOf } from "../../fonts.ts";
import { fitText, maxLinesIn } from "../../text.ts";
import { alertsFor, isSounding, nextOpensAt, showingAt } from "./alerts.ts";
import { ALERT_COLOR } from "./appointment.ts";
import { loadAppointments } from "./appointments.ts";
import { CALENDARS_KEY, eventSettings } from "./settings.ts";
import { REPEAT_MS, playAlert, stopAlert } from "./sound.ts";
import type { DrawResult, Program, ProgramContext } from "../../program.ts";
import type { Region } from "../../text.ts";
import type { Alert } from "./alerts.ts";

const BORDER_ELEMENT_ID = "event-border";
const NAME_ELEMENT_ID = "event-name";
const STARTS_IN_ELEMENT_ID = "event-starts-in";
const COUNTDOWN_ELEMENT_ID = "event-countdown";

// Priorities are whole numbers, so this is the least by which one draw can
// outrank another.
const PRIORITY_STEP = 1;

// One past what a BUSY or CUSTOM work session draws at, which makes this the
// loudest thing the tool has.
//
// Warranted by what the program is rather than by what it is about. An alert
// is brief -- five minutes, or thirty -- and occasional, and it exists
// precisely to interrupt: a program that speaks rarely and briefly is the one
// case where outranking everything is not simply replacing it. The cost is
// real and worth stating, which is that a deliberate focus session is
// interrupted by a meeting alert. That is the intended direction. A focus
// session you chose does not make the meeting go away, and the bar being
// tactful about it is the bar letting you miss it.
const ALERT_PRIORITY = BUSY_SESSION_PRIORITY + PRIORITY_STEP;

// The length of a list with nothing in it.
const NO_CALENDARS = 0;

// How long the program will go without reading the calendars again while it
// has nothing on screen.
//
// The calendars are written by something else and change on their own, so
// waiting only for the next alert we can currently see would miss a meeting
// added ahead of it -- and, on a day whose appointments are all done, would
// mean never looking again at all. This is a floor on curiosity, not a poll:
// it applies only between alerts, where waking costs a fetch and no device
// traffic.
const IDLE_REFRESH_MINUTES = 15;
const IDLE_REFRESH_MS = IDLE_REFRESH_MINUTES * MS_PER_MINUTE;

// The alert is two stacked rows inside a thick frame: the name across the whole
// width, and how long until it underneath.
//
// This is deliberately not how `focus` draws a block, and the difference is the
// difference between the two programs. A block is a thing you are inside, so it
// puts the name and the time side by side and gives the clock a permanent
// column. An appointment is a thing that has not happened yet, so the name is
// the whole message and the time is a caption on it -- and the name, freed of
// the clock's column, gets 66 pixels instead of 47. Measured, that is worth a
// whole font size on a realistic title: "TEST Located 13:15" sets as one line
// of `small` across the full width, and as two truncated lines of `tiny` in the
// old column.
//
// The colour does the rest of the work: yellow is not a phase a focus block
// has, so a yellow frame is unambiguously an appointment and not a block you
// had mislabelled. See ALERT_COLOR.

// Two pixels, so the frame reads as an interruption from across the room rather
// than as the hairline a focus block wears.
//
// Square corners still. The device's `radius` does not round a thin outline so
// much as thicken its corners, and at this weight on a display sixteen tall
// there is nothing to spend on it.
const BORDER_THICKNESS = 2;
const BORDER_RADIUS = 0;

// A frame is paid for twice on each axis, once at each edge.
const EDGES = 2;

// One pixel of clear space between the frame and anything drawn inside it, on
// every side.
//
// It is the most expensive pixel on the display. A two pixel frame already
// leaves twelve rows; taking one off the top and another off the bottom leaves
// ten, and the caption's digits are an immovable five of those -- the device
// draws that face and offers no font for it. So the padding is paid for
// entirely by the name, which drops from six rows to four and, with it, from
// `small` to `tiny`.
//
// That was measured rather than assumed, and the alternative was worse. Five
// rows for the name is enough for `small` only when the name has no descender,
// so "TEST no tail" would set a size larger than "TEST Standup" beside it --
// two alerts a minute apart in different fonts. A name that is uniformly small
// reads as a decision; one that changes size with its own spelling reads as a
// fault.
const PADDING = 1;

// The rightmost column of a region is one short of its width.
const LAST_PIXEL = 1;

// Halving what is left over puts the same amount on each side.
const SIDES = 2;

const CONTENT_LEFT = BORDER_THICKNESS + PADDING;
const CONTENT_WIDTH =
	FRONT_DISPLAY_WIDTH - EDGES * (BORDER_THICKNESS + PADDING);
const CONTENT_TOP = BORDER_THICKNESS + PADDING;

// The last row anything may be drawn on, which the digits sit against.
const CONTENT_BOTTOM =
	FRONT_DISPLAY_HEIGHT - BORDER_THICKNESS - PADDING - LAST_PIXEL;

// The caption is anchored to the bottom of the content and the name gets what
// is left, rather than the other way round: the digits are the one thing here
// whose height is not ours to choose, so everything else is measured from them.
const CAPTION_INK_TOP =
	CONTENT_BOTTOM - COUNTDOWN_METRICS.inkHeight + LAST_PIXEL;

const ROW_GAP = 1;
const NAME_TOP = CONTENT_TOP;
const NAME_HEIGHT = CAPTION_INK_TOP - ROW_GAP - NAME_TOP;

// The gap row is lent to descenders, and to nothing else.
//
// Without lending it there is no room to centre in: a name with no tail takes
// the spare row above it while a name with one gives that row back to the tail
// and ends up sitting higher. Two alerts a minute apart then draw their names
// at different heights, in the same font, for no reason a reader could see.
// Measured on the bar, not reasoned about -- "TEST" came back on rows 3..7 and
// "TEST Standup" on 2..7 before the row was lent.
//
// It is deliberately not counted when choosing the font. A font picked on the
// strength of lent room would put a tail in the gap on every name that had
// one, which is the same unevenness the other way round.
const NAME_REGION: Region = {
	width: CONTENT_WIDTH,
	height: NAME_HEIGHT,
	tailRoom: ROW_GAP,
};

// Every line of the name gets an element, and the same number of elements go
// out on every draw whether or not there is text for them, since an element id
// outlives the drawing that stopped using it.
const NAME_LINE_SLOTS = maxLinesIn(NAME_HEIGHT);
const BLANK_LINE = { text: " ", y: 0 };

// The caption under the name. The device ticks the digits; the word is ours.
//
// "in" rather than "Starts in", and the smallest font there is. The words are
// not the message -- the name above them is, and the digits are what you look
// at -- so they only have to be enough that the clock cannot be read as how
// long the thing lasts, which is what the same shape means in `focus`. Two
// letters do that, and five pixels of width instead of twenty-nine leaves the
// caption sitting well clear of the frame on both sides.
const STARTS_IN_LABEL = "in";
const STARTS_IN_FONT = "tiny";

// Two pixels between the words and the digits.
const LABEL_GAP = 2;

// The countdown is monospaced and comes in exactly two widths, so the caption
// is sized to whichever the remaining time will actually produce.
//
// In practice an alert never shows the hours: the longest lead is thirty
// minutes. It is handled anyway because the alternative is a layout correct
// only for as long as nobody changes a lead time, and being right costs one
// comparison.
const countdownWidth = (remainingMs: number): number =>
	remainingMs >= MS_PER_HOUR
		? COUNTDOWN_METRICS.widthWithHours
		: COUNTDOWN_METRICS.width;

// Words and digits are centred together as one line rather than each on its
// own, so the gap between them stays two pixels whatever the digits are doing.
const captionWidth = (remainingMs: number): number =>
	widthOf(STARTS_IN_LABEL, STARTS_IN_FONT) +
	LABEL_GAP +
	countdownWidth(remainingMs);

const captionLeft = (remainingMs: number): number =>
	Math.floor((FRONT_DISPLAY_WIDTH - captionWidth(remainingMs)) / SIDES);

// The word and the digits are set on a shared baseline rather than a shared
// top, which is what stops two-letter lowercase floating above the clock beside
// it. They are different heights -- the digits are five rows and `tiny` is
// four -- so aligning their tops would put the word a row high.
//
// Each is derived from the baseline separately rather than from the other, so
// changing either font cannot silently knock the two apart.
const LABEL_Y = CONTENT_BOTTOM - FONT_METRICS[STARTS_IN_FONT].baseline;
const COUNTDOWN_Y = CAPTION_INK_TOP - COUNTDOWN_METRICS.inkTop;

const NAME_COLOR = "#FFFFFFFF";

// The frame carries the colour, so it is drawn as an outline and nothing else.
// A fill colour is still required by the generated types even where there is
// no fill to apply.
const NO_FILL_COLORS = ["#00000000"];

// The countdown element takes its target as seconds-based Unix time, in a
// string, and the device ticks it down by itself from there.
//
// Rounded up rather than down, because this is also the drawing's expiry: an
// appointment at 10:00:00.750 would otherwise have its alert vanish three
// quarters of a second before it began.
const unixSeconds = (date: Date): string =>
	String(Math.ceil(date.getTime() / MS_PER_SECOND));

// Whether the bar is currently making a noise.
//
// The chime is asked for again on every draw for as long as the window lasts,
// so what this remembers is only whether there is one to stop when the window
// closes.
let alarming = false;

const drawAlert = async (
	{ bar, applicationName, priority, log }: ProgramContext,
	alert: Alert,
	alerts: readonly Alert[],
	now: Date,
): Promise<DrawResult> => {
	const { appointment, endsAt, soundsFrom } = alert;
	const remainingMs = appointment.start.getTime() - now.getTime();

	// Handing the device the end as an expiry means it takes the alert down
	// itself, on time, even if this process is not around to do it -- and the
	// built-in clock comes back on its own. For a silent alert that is the
	// appointment's own start, so the countdown reaching zero and the alert
	// disappearing are the same instant. For one that makes a noise it is
	// later, because the noise is meant to outlast the start and the screen
	// should not go quiet while the bar is still shouting.
	const displayUntil = unixSeconds(endsAt);

	const { font, lines: fitted } = fitText(appointment.name, NAME_REGION);
	const nameCenterX = CONTENT_LEFT + Math.floor(CONTENT_WIDTH / SIDES);

	// The words sit at the left of the caption and the digits end at its right,
	// which is what keeps the two a fixed two pixels apart.
	const captionX = captionLeft(remainingMs);
	const captionRight = captionX + captionWidth(remainingMs) - LAST_PIXEL;

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
				border_color: ALERT_COLOR,
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
				y: NAME_TOP + line.y,
				display_until: displayUntil,
			})),
			{
				id: STARTS_IN_ELEMENT_ID,
				type: "text",
				text: STARTS_IN_LABEL,
				font: STARTS_IN_FONT,
				color: ALERT_COLOR,
				display: "front",
				align: "top_left",
				x: captionX,
				y: LABEL_Y,
				display_until: displayUntil,
			},
			{
				id: COUNTDOWN_ELEMENT_ID,
				type: "countdown",
				// The appointment's own start, not the alert's end. The digits
				// count down to the thing you are about to be late for, and
				// the device clamps them at 00:00 rather than going negative --
				// so an alert still sounding a minute after the start reads as
				// 00:00, which is exactly what it is.
				timestamp: unixSeconds(appointment.start),
				direction: "time_left",
				show_hours: "when_non_zero",
				color: ALERT_COLOR,
				display: "front",
				// The element's box runs two pixels past its last digit, so
				// the anchor goes that far beyond where the ink should end.
				align: "top_right",
				x: captionRight + COUNTDOWN_METRICS.inkRight,
				y: COUNTDOWN_Y,
				display_until: displayUntil,
			},
		],
	});

	// Played on every draw for as long as the window lasts, rather than once
	// when it opens. The clip is short and the alert is supposed to keep
	// asking until it is answered, so the repeat is the point -- and the draw
	// loop is what the program has to time anything with.
	const sounding = isSounding(alert, now);

	if (sounding) {
		await playAlert(bar, applicationName);
	} else if (alarming) {
		await stopAlert(bar, log);
	}

	// eslint-disable-next-line require-atomic-updates -- a program's draws never overlap, so there is no interleaved update to lose
	alarming = sounding;

	// Three things can change what is on screen, and the next draw is whichever
	// comes first: this alert ending, it starting to make a noise, and a sooner
	// appointment's alert opening over the top of it. While it is making a
	// noise there is a fourth, which is the next chime. The device holds the
	// countdown honest in between all of them.
	const opens = nextOpensAt(alerts, now);
	const instants = [endsAt, opens, soundsFrom].flatMap((instant) =>
		instant !== undefined && instant.getTime() > now.getTime() ? [instant] : [],
	);

	const untilMs = Math.min(
		...instants.map((instant) => instant.getTime() - now.getTime()),
		sounding ? REPEAT_MS : Infinity,
	);

	return { nextDrawInMs: untilMs };
};

// Reading the calendars here is a check, not a cache. `draw` reads them again
// every time; what this buys is that a feed that cannot be reached, or a
// config block naming none at all, stops the program now, with the reason,
// rather than being retried every few seconds behind a bar that sits dark.
//
// A program watching no calendars is refused rather than run. It would be
// indistinguishable from a working one -- silence is what this program looks
// like when nothing is coming up -- and it is what an `event:` block somebody
// has yet to fill in produces, which makes it far more often a mistake than a
// request.
const start = async (context: ProgramContext): Promise<void> => {
	// A run starts with the bar quiet. Said here rather than left to the
	// initialiser so that a second run in the same process -- which is every run
	// after the first in the test suite -- does not inherit the first one's.
	alarming = false;

	const settings = eventSettings(context.config);

	if (settings.calendars.length === NO_CALENDARS) {
		throw new Error(
			`no appointment calendars -- set ${settings.where(CALENDARS_KEY)} to a list of iCalendar feeds`,
		);
	}

	await loadAppointments(settings);
};

const draw = async (context: ProgramContext): Promise<DrawResult> => {
	const now = new Date();

	// Taken from the block again rather than held from `start`, which costs
	// nothing: the file was read once, at startup, and this is one key out of
	// what it said.
	const settings = eventSettings(context.config);

	// Read afresh on every draw rather than resolved once at startup. The
	// calendars belong to whatever is filling them in, and a meeting added
	// this morning has to reach a process that started yesterday.
	const appointments = await loadAppointments(settings);
	const alerts = alertsFor(appointments, settings);
	const showing = showingAt(alerts, now);

	if (showing !== undefined) {
		return await drawAlert(context, showing, alerts, now);
	}

	if (alarming) {
		alarming = false;
		await stopAlert(context.bar, context.log);
	}

	// Between alerts there is nothing to draw and nothing to clear: the last
	// alert's elements were given its end as their expiry, so the device has
	// already taken them down and handed the screen back.
	const opens = nextOpensAt(alerts, now);
	const untilNextAlert =
		opens === undefined ? Infinity : opens.getTime() - now.getTime();

	return { nextDrawInMs: Math.min(untilNextAlert, IDLE_REFRESH_MS) };
};

const event: Program = {
	name: "event",
	description: "Alerts ahead of the appointments in your calendars",
	priority: ALERT_PRIORITY,
	start,
	draw,
};

export { ALERT_PRIORITY, IDLE_REFRESH_MS, event };
