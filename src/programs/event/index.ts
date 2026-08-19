import {
	BUSY_SESSION_PRIORITY,
	FRONT_DISPLAY_HEIGHT,
	FRONT_DISPLAY_MIDDLE_X,
	FRONT_DISPLAY_WIDTH,
} from "../../constants/device.ts";
import { MS_PER_HOUR, MS_PER_SECOND } from "../../constants/time.ts";
import { clearApplication } from "../../display.ts";
import { COUNTDOWN_METRICS, FONT_METRICS, widthOf } from "../../fonts.ts";
import { fitText, maxLinesIn } from "../../text.ts";
import { createAcknowledgements } from "./acknowledgements.ts";
import { alertsFor, isSounding, nextOpensAt, showingAt } from "./alerts.ts";
import { ALERT_COLOR } from "./appointment.ts";
import { createRefresher } from "./refresh.ts";
import { CALENDARS_KEY, eventSettings } from "./settings.ts";
import { REPEAT_MS, playAlert, stopAlert } from "./sound.ts";
import type { Button } from "../../input/buttons.ts";
import type {
	DrawResult,
	InputResult,
	Program,
	ProgramContext,
} from "../../program.ts";
import type { Region } from "../../text.ts";
import type { Alert } from "./alerts.ts";
import type { Appointment } from "./appointment.ts";

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

// What the countdown would have left to run once the appointment has begun.
const NO_TIME_LEFT = 0;

// How long the frame stays lit, and then dark, once the appointment has begun.
//
// The frame blinks rather than the whole alert, and rather than the word. A
// name and a "NOW" that came and went would be a message you have to wait to
// read, which is the opposite of what an alert is for -- everything stays
// legible the entire time and only the border moves. It is also the part
// already doing the interrupting: two pixels of yellow around the edge is what
// makes this readable from across the room, so it is what there is to escalate.
//
// Half a second is slow enough to read as deliberate rather than as a fault,
// and it only ever happens while an appointment has begun and nobody has
// answered -- which is bounded by `sound.linger`.
const BLINK_MS = 500;
const BLINK_PHASES = 2;
const DARK_PHASE = 1;

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

// What the caption says once the appointment has begun.
//
// "in 00:00" is a sentence that has stopped being true. The digits clamp at
// zero rather than counting negative, which is right as far as it goes, but a
// clock reading 00:00 is a thing you have to interpret -- it looks like a timer
// that has finished, which is exactly the wrong impression for the one moment
// the bar is trying to say you are late. A word says it without arithmetic.
//
// Only an alert that outlasts its start ever shows this. One with somewhere to
// be ends at the start, so it is gone rather than saying anything.
//
// `small` because the caption band is the five rows the digits occupied and
// `small` is five rows of capitals -- it takes exactly the space the clock gave
// back, so nothing above it has to move.
const NOW_LABEL = "NOW";
const NOW_FONT = "small";
const NOW_Y = CONTENT_BOTTOM - FONT_METRICS[NOW_FONT].baseline;

// Where the countdown goes when there is nothing left to count.
//
// A text element is blanked with a single space, and the same trick is needed
// here for the same reason: an element id outlives the drawing that stopped
// using it, so a countdown left out of a draw stays on screen. A countdown has
// no blank -- the device draws the digits and takes no text -- so the
// equivalent is to put it where the display is not. Anchored at its right edge,
// a whole display's width to the left of the origin, it draws nothing.
//
// The alternative was clearing the application and drawing again, which would
// blink the whole alert off and on at the moment it most wants to be read.
const OFF_SCREEN_X = -FRONT_DISPLAY_WIDTH;

const NAME_COLOR = "#FFFFFFFF";

// Fully transparent: a colour that draws nothing.
const INVISIBLE = "#00000000";

// The frame carries the colour, so it is drawn as an outline and nothing else.
// A fill colour is still required by the generated types even where there is
// no fill to apply.
const NO_FILL_COLORS = [INVISIBLE];

// The countdown element takes its target as seconds-based Unix time, in a
// string, and the device ticks it down by itself from there.
//
// Rounded up rather than down, because this is also the drawing's expiry: an
// appointment at 10:00:00.750 would otherwise have its alert vanish three
// quarters of a second before it began.
const unixSeconds = (date: Date): string =>
	String(Math.ceil(date.getTime() / MS_PER_SECOND));

// What the program has on the screen, and whether it is making a noise.
//
// The button is why this exists. A press has to be able to answer the alert
// you are looking at, and nothing hands the handler what that is -- so the
// draw leaves it here on its way out. Undefined is the ordinary state: this
// program draws nothing at all most of the day, and a press then is a press
// about something else.
//
// It is deliberately not the alert's identity written to disk anywhere.
// Acknowledgement is a fact about the last few minutes, and a process that has
// restarted was not there when the button was pressed.
let onScreen: Appointment | undefined = undefined;
let alarming = false;

// When the chime last played.
//
// The repeat used to be "once per draw while sounding", which was only ever
// right because the draw loop happened to run at the repeat interval. It does
// not any more: the frame blinks twice a second once an appointment has begun,
// and a chime on every one of those draws would be a solid two minutes of
// noise. What the alert repeats and what the screen repeats are two different
// rhythms, so the chime keeps its own.
let lastChimeAt: Date | undefined = undefined;
let acknowledged = createAcknowledgements();

// The calendars, read on their own clock rather than on the draw's.
const refresher = createRefresher();

// Keeps the chime going, or stops it, and says how long until the next one.
//
// Separate from the draw because the two used to be the same thing, and were
// only ever right by coincidence: "play on every draw while sounding" gave a
// ten second repeat because the draw loop happened to run every ten seconds.
// Once the frame blinks twice a second that coincidence becomes two solid
// minutes of noise, so what the alert repeats and what the screen repeats are
// tracked apart.
const keepSounding = async (
	{ bar, applicationName, log }: ProgramContext,
	sounding: boolean,
	now: Date,
): Promise<number> => {
	if (!sounding) {
		if (alarming) {
			await stopAlert(bar, log);
		}

		// eslint-disable-next-line require-atomic-updates -- a program's draws never overlap, so there is no interleaved update to lose
		alarming = false;
		// Forgotten while silent, so the next alert to open chimes at once
		// rather than waiting out the gap left by the last one.
		lastChimeAt = undefined;

		return Infinity;
	}

	if (
		lastChimeAt === undefined ||
		now.getTime() - lastChimeAt.getTime() >= REPEAT_MS
	) {
		await playAlert(bar, applicationName);
		// eslint-disable-next-line require-atomic-updates -- as above
		lastChimeAt = now;
	}

	alarming = true;

	return lastChimeAt.getTime() + REPEAT_MS - now.getTime();
};

const drawAlert = async (
	context: ProgramContext,
	alert: Alert,
	alerts: readonly Alert[],
	now: Date,
): Promise<DrawResult> => {
	const { bar, applicationName, priority } = context;
	const { appointment, endsAt, soundsFrom } = alert;
	const remainingMs = appointment.start.getTime() - now.getTime();

	// Past the start and still up, which only a chiming alert ever is.
	const begun = remainingMs <= NO_TIME_LEFT;

	// Worked out from the clock rather than toggled, so that the frame is in
	// the same phase whichever draw happens to land -- a flag would blink on
	// the draws rather than on the time, and the draws are not evenly spaced.
	const dark =
		begun && Math.floor(now.getTime() / BLINK_MS) % BLINK_PHASES === DARK_PHASE;

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
				border_color: dark ? INVISIBLE : ALERT_COLOR,
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
			begun
				? {
						id: STARTS_IN_ELEMENT_ID,
						type: "text",
						text: NOW_LABEL,
						font: NOW_FONT,
						color: ALERT_COLOR,
						display: "front",
						align: "top_mid",
						x: FRONT_DISPLAY_MIDDLE_X,
						y: NOW_Y,
						display_until: displayUntil,
					}
				: {
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
				x: begun ? OFF_SCREEN_X : captionRight + COUNTDOWN_METRICS.inkRight,
				y: COUNTDOWN_Y,
				display_until: displayUntil,
			},
		],
	});

	// Claimed only once the draw has landed. A draw that was refused put
	// nothing on the screen, and a press answering an alert nobody can see
	// would silence the one that is about to replace it.
	onScreen = appointment;

	// Played on every draw for as long as the window lasts, rather than once
	// when it opens. The clip is short and the alert is supposed to keep
	// asking until it is answered, so the repeat is the point -- and the draw
	// loop is what the program has to time anything with.
	const untilNextChime = await keepSounding(
		context,
		isSounding(alert, now),
		now,
	);

	// Four things can change what is on screen, and the next draw is whichever
	// comes first: this alert ending, it starting to make a noise, the
	// appointment beginning -- which is when the clock is replaced by the word
	// -- and a sooner appointment's alert opening over the top of it. While it
	// is making a noise there is a fifth, which is the next chime. The device holds the
	// countdown honest in between all of them.
	const opens = nextOpensAt(alerts, now);
	const instants = [endsAt, opens, soundsFrom, appointment.start].flatMap(
		(instant) =>
			instant !== undefined && instant.getTime() > now.getTime()
				? [instant]
				: [],
	);

	// The chime and the blink each keep their own rhythm, and the next draw is
	// whichever of everything comes first.
	return {
		nextDrawInMs: Math.min(
			...instants.map((instant) => instant.getTime() - now.getTime()),
			untilNextChime,
			begun ? BLINK_MS : Infinity,
		),
	};
};

// The first read happens here, and fails the program if it fails: a feed that
// cannot be reached, or a config block naming none at all, stops things now,
// with the reason, rather than being retried every few seconds behind a bar
// that sits dark.
//
// Every read after this one is the refresher's, on its own interval.
//
// A program watching no calendars is refused rather than run. It would be
// indistinguishable from a working one -- silence is what this program looks
// like when nothing is coming up -- and it is what an `event:` block somebody
// has yet to fill in produces, which makes it far more often a mistake than a
// request.
const start = async (context: ProgramContext): Promise<void> => {
	// A run starts having acknowledged nothing and shown nothing. Said here
	// rather than left to the initialisers so that a second run in the same
	// process -- which is every run after the first in the test suite -- is not
	// answering the first one's alerts.
	onScreen = undefined;
	alarming = false;
	lastChimeAt = undefined;
	acknowledged = createAcknowledgements();

	const settings = eventSettings(context.config);

	if (settings.calendars.length === NO_CALENDARS) {
		throw new Error(
			`no appointment calendars -- set ${settings.where(CALENDARS_KEY)} to a list of iCalendar feeds`,
		);
	}

	await refresher.begin(settings, context);
};

const draw = async (context: ProgramContext): Promise<DrawResult> => {
	const now = new Date();

	// A calendar that could not be read belongs on the bar, not only in a log.
	// Silence is what this program looks like when it is working, so a bar
	// showing nothing because it has not managed to read a feed since breakfast
	// is indistinguishable from a quiet afternoon -- which is the whole reason
	// failures are drawn.
	const failure = refresher.failure();

	if (failure !== undefined) {
		throw failure;
	}

	// Taken from the block again rather than held from `start`, which costs
	// nothing: the file was read once, at startup, and this is a few keys out
	// of what it said.
	const settings = eventSettings(context.config);

	// Whatever the refresher last read. Nothing is fetched here: how fresh the
	// calendars are is its own question, asked on its own clock.
	const appointments = refresher.appointments();

	acknowledged.keepOnly(appointments);

	// An acknowledged appointment is not an alert at all. Filtering here rather
	// than at the point of drawing means it is also not what the program waits
	// for: an alert you have answered must not be what wakes it up.
	const alerts = alertsFor(appointments, settings).filter(
		({ appointment }) => !acknowledged.has(appointment),
	);

	const showing = showingAt(alerts, now);

	if (showing !== undefined) {
		return await drawAlert(context, showing, alerts, now);
	}

	if (alarming) {
		alarming = false;
		lastChimeAt = undefined;
		await stopAlert(context.bar, context.log);
	}

	// An alert that was up and is not any more comes down here, rather than
	// being left to the expiry it was drawn with.
	//
	// Almost always the device has already taken it down: the elements carry the
	// alert's end as their `display_until` and this draw was scheduled for that
	// instant, so the clear is a formality. What it is actually for is the case
	// where the alert stopped being one for a reason the device knows nothing
	// about -- the meeting was cancelled, or moved, or the calendar it came from
	// stopped mentioning it.
	if (onScreen !== undefined) {
		onScreen = undefined;
		await clearApplication(context.bar, context.applicationName);
		context.releaseScreen();
	}

	// Otherwise there is nothing to draw and nothing to clear, and -- now that
	// reading the calendars is not this loop's job -- nothing to come back for
	// until an alert is due. A day with nothing left in it asks for no draws at
	// all; the refresher is what notices when that stops being true.
	const opens = nextOpensAt(alerts, now);

	return opens === undefined
		? {}
		: { nextDrawInMs: opens.getTime() - now.getTime() };
};

// A press of any of the bar's three buttons answers the alert on screen.
//
// Any of them, deliberately. The bar has three buttons and this program has
// one thing to say, and a rule about which of them counts is a rule you have
// to remember at the exact moment you are late for something. The press means
// "I have seen it", and there is nothing else it could mean while an alert is
// up.
//
// It answers whatever is on screen, sounding or not. Acknowledgement was asked
// for so that a noise could be stopped, but a bar that only takes an answer
// while it is making a noise is a bar with a rule nobody was told: the yellow
// frame is the same interruption either way, and being able to dismiss the one
// that chimes and not the one that does not would read as a fault.
//
// A press with nothing on screen does nothing at all. Every program that takes
// presses hears every press, so most of what arrives here is somebody using
// the bar for something else entirely.
const onButton = async (
	button: Button,
	{ bar, applicationName, log, releaseScreen }: ProgramContext,
): Promise<InputResult> => {
	if (onScreen === undefined) {
		return {};
	}

	acknowledged.acknowledge(onScreen);
	onScreen = undefined;

	if (alarming) {
		alarming = false;
		lastChimeAt = undefined;
		await stopAlert(bar, log);
	}

	// The elements were drawn to expire when the alert would have ended, so
	// they outlast being answered unless they are taken down.
	await clearApplication(bar, applicationName);

	// Whatever this alert interrupted is gone rather than merely covered: the
	// device destroys a lower-priority application's elements rather than
	// hiding them behind ours, and their owner never saw a refusal that would
	// have told it so. Nothing else will put the screen back.
	releaseScreen();

	log(`acknowledged by the ${button} button`);

	return { redraw: true };
};

const event: Program = {
	name: "event",
	description: "Alerts ahead of the appointments in your calendars",
	priority: ALERT_PRIORITY,
	start,
	draw,
	onButton,
};

export { ALERT_PRIORITY, INVISIBLE, event };
