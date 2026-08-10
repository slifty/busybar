import {
	FONTS_BY_SIZE,
	FONT_METRICS,
	GLYPH_SPACING,
	ROWS_INCLUSIVE,
	SMALLEST_FONT,
	capBandOf,
	inkBoxOf,
	widthOf,
} from "./fonts.ts";
import type { Font, InkBox } from "./fonts.ts";

// Fitting a string into a region of the display, by choosing a font and
// breaking the string across lines rather than by scrolling it.
//
// Scrolling is the device's own answer to text that does not fit, and it is
// the wrong one here: it turns a thing you glance at into a thing you wait
// for, and any redraw restarts the animation from the beginning. Text that
// stands still can be read in the moment you look up.
//
// What is left is a search. Every font is measured, so the largest one whose
// wrapped lines fit the region can be found by trying them in order.

// One blank row between lines. Nothing separates them otherwise -- the metrics
// run from the top of a capital to the bottom of a descender, so without a gap
// a descender on one line would sit directly on the capitals of the next.
const LINE_GAP = 1;

// Text that cannot be made to fit at any size is cut, and says so. Three
// periods rather than an ellipsis character, which the bitmap fonts cannot
// draw.
const ELLIPSIS = "...";

// A region has to hold at least one line for anything to be drawn in it at
// all, however little room it has.
const MINIMUM_LINES = 1;

// The least a line of text can occupy: one row of ink. Nothing says a line has
// to use the whole of its font's nominal box, and on a sixteen pixel display
// the difference decides whether a second line is possible at all.
const MINIMUM_INK = 1;

// Halving what is left over puts the same amount on each side.
const SIDES = 2;

// Where a slice of lines starts when it is the first of them that is wanted.
const FROM_START = 0;

// A region that has lent nothing keeps its tails strictly inside itself.
const NO_TAIL_ROOM = 0;

// An empty string wraps to no lines at all.
const NO_LINES = 0;

interface Region {
	readonly width: number;
	readonly height: number;
	// Rows below the region that a descender's tail may reach into, and that
	// nothing else may use.
	//
	// A caller with padding to spare can lend one row of it. Without that, a
	// region only just deep enough for a font has no slack to centre in: the
	// tail hits the bottom, the text is pushed back up, and a name with a tail
	// ends up sitting a row above a name without one -- which is the very
	// unevenness that centring by the cap band is there to remove. A tail is
	// also the one part of a letter that can sit close to a frame without
	// looking crowded, being a stroke rather than a body.
	readonly tailRoom?: number;
}

// A line of text and where to put it: `y` is the offset from the top of the
// region to the y of a top-aligned element, with the font's own ink offset
// already taken out. A caller adds the region's own y and draws.
interface FittedLine {
	readonly text: string;
	readonly y: number;
}

interface FittedText {
	readonly font: Font;
	readonly lines: readonly FittedLine[];
}

// How far apart consecutive lines are drawn. This is the nominal box rather
// than the ink, so that a line with a descender and one without still sit on
// an even rhythm.
const stepFor = (font: Font): number => {
	const {
		[font]: { lineHeight },
	} = FONT_METRICS;

	return lineHeight + LINE_GAP;
};

// The most lines of a font a region could ever hold, which is what the lines
// would come to if each had a single row of ink. Whether a particular set of
// lines fits is answered by measuring them, not by this.
const linesThatFit = (font: Font, height: number): number =>
	Math.floor((height - MINIMUM_INK) / stepFor(font)) + MINIMUM_LINES;

// The longest run of characters from the front of the string that fits.
const prefixFitting = (text: string, width: number, font: Font): string => {
	let taken = "";

	for (const character of text) {
		const candidate = taken + character;

		if (widthOf(candidate, font) > width) {
			break;
		}

		taken = candidate;
	}

	return taken;
};

interface Wrapped {
	readonly lines: readonly string[];
	// Whether a word had to be split to make it fit at all, which is a font
	// being too big for the region rather than a wrap that came out long.
	readonly broken: boolean;
}

// Greedy word wrapping, breaking inside a word only when the word is wider
// than the region on its own.
//
// The search rejects any font that had to break a word, on the grounds that a
// smaller one will not have to. It is only the last resort -- where there is
// no smaller one -- that keeps a broken word, and it would rather break the
// tail of a name than lose the whole of it.
const wrapped = (text: string, width: number, font: Font): Wrapped => {
	const lines: string[] = [];
	let broken = false;
	let line = "";

	const settle = (): void => {
		if (line !== "") {
			lines.push(line);
			line = "";
		}
	};

	for (const word of text.split(" ").filter((each) => each !== "")) {
		let rest = word;

		while (widthOf(rest, font) > width) {
			settle();

			const head = prefixFitting(rest, width, font);

			if (head === "") {
				// Not even one character fits, so there is nothing further to
				// be done with the rest of the string either.
				return { lines, broken: true };
			}

			lines.push(head);
			rest = rest.slice(head.length);
			broken = true;
		}

		const candidate = line === "" ? rest : `${line} ${rest}`;

		if (widthOf(candidate, font) <= width) {
			line = candidate;
			continue;
		}

		settle();
		line = rest;
	}

	settle();

	return { lines, broken };
};

// Cuts a wrap down to the lines there is room for, and marks the loss.
//
// The lines it keeps are the wrapped ones, so what survives still breaks at
// spaces: "Deep Work:" and "Rendering..." rather than "Deep Work: Re" and
// "ndering Pipel...". Only the line carrying the ellipsis is cut mid-word, and
// only as far as the ellipsis needs.
const ellipsized = (
	lines: readonly string[],
	maxLines: number,
	width: number,
	font: Font,
): string[] => {
	if (lines.length <= maxLines) {
		return [...lines];
	}

	const kept = lines.slice(FROM_START, maxLines);
	const last = kept.pop() ?? "";

	// What is left for the text once the ellipsis and the spacing before it
	// have taken their share.
	const room = width - widthOf(ELLIPSIS, font) - GLYPH_SPACING;

	// Clipped once more, so that even a region too narrow for the ellipsis
	// itself cannot produce something wider than it was given.
	return [
		...kept,
		prefixFitting(prefixFitting(last, room, font) + ELLIPSIS, width, font),
	];
};

// The rows a set of lines would cover, measured with whichever box is asked
// for: the whole of the ink, or only the band down to the baseline.
//
// Measuring what the strings actually have, rather than the font's nominal
// box, is what lets a second line exist at all in a region as short as this
// one -- and what makes a name with no descender fill the space a name with
// one would have needed.
const extentOf = (
	lines: readonly string[],
	font: Font,
	boxOf: (text: string, font: Font) => InkBox,
): InkBox => {
	const step = stepFor(font);

	let top = Infinity;
	let bottom = -Infinity;

	lines.forEach((text, index) => {
		const box = boxOf(text, font);

		top = Math.min(top, index * step + box.top);
		bottom = Math.max(bottom, index * step + box.bottom);
	});

	return { top, bottom };
};

// Centres a set of lines vertically in the region and hands back where each
// one is drawn.
//
// Lines are spaced by the font's nominal box, so that a line with a descender
// and one without still sit on an even rhythm.
//
// What the block is *centred* by is its cap band -- the tops of the letters
// down to the line they stand on -- and not the whole of the ink. A descender
// is a tail hanging off the text rather than part of the mass the eye
// balances, so counting it would sit every name carrying one two rows above
// every name that does not, in the same font, on the same bar. The tail is
// then kept inside the region by the clamp below rather than by the centring,
// which is the one place it has any business being considered.
const placed = (
	lines: readonly string[],
	font: Font,
	height: number,
	tailRoom: number,
): FittedText => {
	// Nothing to place, and nowhere to put it. Measuring an empty set of lines
	// would give an extent of Infinity to -Infinity and carry NaN through
	// everything below it; no line would come out holding the NaN, since there
	// are no lines, but a caller drawing one element per line would send a
	// draw with no elements in it. Saying so here is cheaper than each caller
	// discovering it.
	if (lines.length === NO_LINES) {
		return { font, lines: [] };
	}

	const step = stepFor(font);
	const band = extentOf(lines, font, capBandOf);
	const ink = extentOf(lines, font, inkBoxOf);

	// Rounded up rather than down, so that an odd row left over falls above
	// the text rather than below it. There is no centring a five row band in
	// ten rows; the choice is only which way it misses, and text sitting a
	// row low reads as centred where text sitting a row high reads as wrong.
	const bandHeight = band.bottom - band.top + ROWS_INCLUSIVE;
	const centred = Math.ceil((height - bandHeight) / SIDES) - band.top;

	// A tail may not leave the region, beyond whatever room it was lent. Where
	// the ink is taller than that -- which only the last-resort fallback can
	// produce -- the top wins, because losing the bottom of a descender costs
	// less than losing the top of a capital.
	const offset = Math.max(
		Math.min(centred, height + tailRoom - ROWS_INCLUSIVE - ink.bottom),
		-ink.top,
	);

	return {
		font,
		lines: lines.map((text, index) => ({
			text,
			y: offset + index * step,
		})),
	};
};

const fitsIn = (
	lines: readonly string[],
	font: Font,
	height: number,
): boolean => {
	const { top, bottom } = extentOf(lines, font, inkBoxOf);

	return bottom - top + ROWS_INCLUSIVE <= height;
};

// The largest font in which the whole string fits the region, wrapped across
// as many lines as the region has room for.
const fitText = (text: string, region: Region): FittedText => {
	const { width, height, tailRoom = NO_TAIL_ROOM } = region;

	for (const font of FONTS_BY_SIZE) {
		const { lines, broken } = wrapped(text, width, font);

		// Whether a font fits is asked of the region proper. Lent room is for
		// centring what already fits, not for squeezing in a size that does
		// not -- a font chosen on the strength of it would put its tail in the
		// padding on every name that had one.
		if (!broken && fitsIn(lines, font, height)) {
			return placed(lines, font, height, tailRoom);
		}
	}

	// Nothing fitted, so the smallest font takes it and loses what it must.
	//
	// How much it loses is found by trying: the line count a region could hold
	// assumes a single row of ink per line, and real lines are taller than
	// that, so the first count to try is an upper bound rather than an answer.
	const { lines } = wrapped(text, width, SMALLEST_FONT);
	const most = Math.max(linesThatFit(SMALLEST_FONT, height), MINIMUM_LINES);

	for (let allowed = most; allowed > MINIMUM_LINES; allowed -= MINIMUM_LINES) {
		const candidate = ellipsized(lines, allowed, width, SMALLEST_FONT);

		if (fitsIn(candidate, SMALLEST_FONT, height)) {
			return placed(candidate, SMALLEST_FONT, height, tailRoom);
		}
	}

	// One line, whether or not the region can hold even that. A bar showing
	// nothing looks like a bar with nothing to say.
	return placed(
		ellipsized(lines, MINIMUM_LINES, width, SMALLEST_FONT),
		SMALLEST_FONT,
		height,
		tailRoom,
	);
};

// The most lines `fitText` could ever put in a region this tall.
//
// A caller that draws each line as its own element needs this: element ids
// persist on the device until they expire or are replaced, so a drawing that
// went from two lines to one would leave the second line behind unless it
// knew how many slots to account for.
const maxLinesIn = (height: number): number =>
	Math.max(
		...FONTS_BY_SIZE.map((font) => linesThatFit(font, height)),
		MINIMUM_LINES,
	);

export { fitText, maxLinesIn };
export type { FittedLine, FittedText, Region };
