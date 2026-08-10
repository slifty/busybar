// What the device's bitmap fonts actually measure.
//
// The API takes a font by name and gives no way to ask how wide a string will
// come out, so anything that has to fit text into a region has to know the
// metrics up front. These were measured off a real bar: each character was
// drawn and the frame read back, with the advance taken as
// width("cc") - width("c") so that the glyph's side bearings cancel rather
// than being assumed to be zero. Space carries no ink, so it came from
// width("A A") - width("AA") instead.
//
// Two fonts the API offers are deliberately absent. `condensed` measured
// identical to `normal` in every glyph, so the device appears to render them
// the same and offering both would be a choice with no effect. `extra_large`
// renders lowercase input as capitals, which changes what a name says rather
// than only how big it is.
//
// Regenerate with tools/measure-fonts.ts and tools/measure-glyph-rows.ts if
// the firmware's fonts ever change.

// The fonts are bitmap ASCII, so the tables cover printable ASCII and nothing
// else. Anything outside it cannot be drawn at all -- see `drawableName`.
const FIRST_CODE = 0x20;
const LAST_CODE = 0x7e;

// Advance widths in pixels, indexed by code point - FIRST_CODE.
//
// An advance is the ink of the glyph plus the one pixel of spacing that
// follows it, which is why a string's ink is its advances less one: the last
// glyph's spacing is never drawn.
const ADVANCE_WIDTHS = {
	tiny: [
		3, 2, 4, 6, 4, 5, 5, 2, 3, 3, 4, 4, 2, 4, 2, 5, 4, 4, 4, 4, 4, 4, 4, 4, 4,
		4, 2, 2, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4, 5, 4, 6, 5, 5, 4, 5,
		4, 4, 4, 5, 6, 6, 4, 6, 5, 3, 5, 3, 4, 4, 3, 4, 4, 4, 4, 4, 3, 3, 4, 2, 2,
		4, 2, 6, 4, 4, 4, 4, 3, 4, 4, 4, 4, 6, 4, 4, 4, 4, 2, 4, 5,
	],
	small: [
		2, 2, 4, 6, 4, 5, 5, 2, 3, 3, 4, 4, 2, 3, 2, 3, 4, 3, 4, 4, 4, 4, 4, 4, 4,
		4, 2, 3, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 5, 5, 5, 2, 4, 5, 4, 6, 5, 5, 5, 5,
		5, 5, 4, 5, 4, 6, 4, 4, 4, 3, 3, 3, 4, 4, 6, 4, 4, 4, 4, 4, 3, 4, 4, 2, 3,
		4, 2, 6, 4, 4, 4, 4, 3, 4, 3, 4, 4, 6, 4, 4, 4, 4, 2, 4, 5,
	],
	normal: [
		5, 3, 4, 6, 6, 8, 7, 2, 3, 3, 4, 6, 3, 4, 4, 5, 6, 6, 6, 6, 6, 6, 6, 6, 6,
		6, 2, 3, 4, 6, 4, 6, 8, 6, 6, 6, 6, 6, 6, 6, 6, 4, 5, 6, 5, 8, 6, 6, 6, 6,
		6, 6, 6, 6, 6, 8, 6, 6, 6, 3, 5, 3, 6, 5, 7, 5, 5, 5, 5, 5, 5, 5, 5, 4, 4,
		5, 4, 6, 5, 5, 5, 5, 4, 5, 5, 5, 6, 6, 6, 5, 5, 4, 3, 4, 6,
	],
	bold: [
		5, 4, 4, 8, 9, 9, 8, 2, 4, 4, 4, 7, 3, 4, 4, 6, 7, 7, 7, 7, 7, 7, 7, 7, 7,
		7, 2, 3, 5, 7, 5, 7, 10, 7, 7, 7, 7, 6, 6, 7, 7, 5, 6, 7, 6, 10, 8, 7, 7, 7,
		7, 7, 7, 7, 8, 11, 7, 7, 7, 4, 6, 4, 7, 5, 7, 6, 6, 6, 6, 6, 6, 6, 6, 5, 5,
		6, 5, 8, 6, 6, 6, 6, 5, 6, 6, 6, 7, 8, 7, 6, 6, 5, 4, 5, 6,
	],
	large: [
		6, 3, 4, 9, 8, 10, 9, 2, 4, 4, 6, 6, 3, 4, 4, 6, 7, 5, 7, 7, 7, 7, 7, 7, 7,
		7, 2, 3, 5, 6, 5, 6, 10, 8, 7, 7, 8, 7, 7, 8, 8, 4, 7, 7, 7, 10, 8, 8, 7, 8,
		7, 7, 8, 8, 8, 10, 8, 8, 7, 3, 6, 3, 6, 6, 8, 6, 6, 6, 6, 6, 5, 6, 6, 4, 4,
		6, 4, 8, 6, 6, 6, 6, 5, 6, 5, 6, 6, 10, 6, 6, 6, 4, 2, 4, 8,
	],
} as const;

type Font = keyof typeof ADVANCE_WIDTHS;

// Where a font's ink lands, in pixels below the y an element is drawn at.
//
// `inkTop` is the top of a capital, and `lineHeight` runs from there to the
// bottom of a descender, so it is the full height of ordinary mixed-case text.
// Positioning is done from the ink rather than from the element box because
// the box is not something the API reports either, and it is the ink that has
// to sit inside a region and look centred.
//
// Bracket and quote characters reach roughly two pixels above `inkTop` and one
// below the descender in every font but `tiny`. Sizing to those would cost a
// line of text in a sixteen pixel display for characters that are vanishingly
// rare in a block name.
// `baseline` is the row the letters sit on -- the bottom of a capital, and of
// everything else that is not a descender.
interface FontMetrics {
	readonly inkTop: number;
	readonly baseline: number;
	readonly lineHeight: number;
}

const FONT_METRICS: Record<Font, FontMetrics> = {
	tiny: { inkTop: 1, baseline: 4, lineHeight: 5 },
	small: { inkTop: 2, baseline: 6, lineHeight: 6 },
	normal: { inkTop: 2, baseline: 8, lineHeight: 9 },
	bold: { inkTop: 2, baseline: 8, lineHeight: 9 },
	large: { inkTop: 2, baseline: 10, lineHeight: 11 },
} as const;

// Which rows each glyph's ink actually occupies, as [top, bottom, characters]
// with the rows counted from the y the element is drawn at. Characters sharing
// an extent are grouped, because most of them do.
//
// The nominal box above is what lines are spaced by, and this is what they are
// centred by, which are not the same question. "Email" has no descender and
// nothing above the capitals, so centring it on a box that reserves room for
// both would sit it visibly high. Centring on the ink a string actually has
// puts it where the eye expects it, at every size.
const INK_ROWS: Record<
	Font,
	ReadonlyArray<readonly [number, number, string]>
> = {
	tiny: [
		[1, 2, "\"'^`~"],
		[1, 3, "*"],
		[1, 4, "!%&/0123456789?@ABCDEFGHIJKLMNOPRSTUVWXYZ\\bdfhiklt"],
		[1, 5, "#$()<>Q[]j{|}"],
		[2, 4, "+:=acemnorsuvwxz"],
		[2, 5, ";gpqy"],
		[3, 3, "-"],
		[4, 4, "."],
		[4, 5, ","],
		[5, 5, "_"],
	],
	small: [
		[0, 8, "`"],
		[2, 3, "\"'^"],
		[2, 5, "%*"],
		[2, 6, "!#&()/0123456789<>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]bdfhiklt{|}"],
		[2, 7, "$"],
		[2, 8, "j"],
		[3, 5, "+="],
		[3, 6, ":acemnorsuvwxz"],
		[3, 7, ";gpqy"],
		[4, 4, "-"],
		[4, 5, "~"],
		[6, 6, "._"],
		[6, 7, ","],
	],
	normal: [
		[0, 10, "`"],
		[2, 3, "\"'"],
		[2, 4, "^"],
		[2, 5, "*"],
		[2, 8, "!#%&()/0123456789?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]bdfhiklt{|}"],
		[2, 9, "$"],
		[2, 10, "j"],
		[3, 7, "+:<>"],
		[3, 9, ";"],
		[4, 6, "=~"],
		[4, 8, "acemnorsuvwxz"],
		[4, 10, "gpqy"],
		[5, 5, "-"],
		[8, 8, "._"],
		[8, 10, ","],
	],
	bold: [
		[0, 10, "`"],
		[2, 3, "\"'"],
		[2, 4, "^"],
		[2, 5, "*"],
		[2, 8, "!#%&()/0123456789?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]bdfhiklt{|}"],
		[2, 9, "$"],
		[2, 10, "j"],
		[3, 7, "+:<>"],
		[3, 9, ";"],
		[4, 6, "="],
		[4, 7, "~"],
		[4, 8, "acemnorsuvwxz"],
		[4, 10, "gpqy"],
		[5, 5, "-"],
		[8, 8, "._"],
		[8, 10, ","],
	],
	large: [
		[0, 12, "`"],
		[2, 3, "\"'"],
		[2, 4, "^"],
		[2, 6, "*"],
		[2, 10, "!#$%&()/0123456789?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]bdfhiklt{|}"],
		[2, 12, "j"],
		[3, 9, "<>"],
		[4, 8, "+:"],
		[4, 10, ";"],
		[5, 7, "=~"],
		[5, 10, "acemnorsuvwxz"],
		[5, 12, "gpqy"],
		[6, 6, "-"],
		[10, 10, "._"],
		[10, 12, ","],
	],
} as const;

// Biggest first, which is the order anything fitting text wants to try them
// in. `bold` sits above `normal` because the two are the same height, so when
// both fit there is nothing to weigh up: the heavier one is easier to read
// across a room.
const FONTS_BY_SIZE: readonly Font[] = [
	"large",
	"bold",
	"normal",
	"small",
	"tiny",
];

// The end of that ladder, named because falling back to it is a decision
// rather than an index: there is nothing smaller to try.
const SMALLEST_FONT: Font = "tiny";

// Every glyph is followed by a pixel of spacing, and it is part of the
// advance. A string's ink is therefore its advances less one, because the
// spacing after the last glyph is never drawn.
const GLYPH_SPACING = 1;

const NO_INK = 0;

// A single character's code point is the one at the start of it.
const ONLY_CHARACTER = 0;

// Used for anything the tables do not cover, so an unmeasured character can
// only ever make a fit more cautious rather than overflow the region.
const widestAdvance = (font: Font): number => {
	const { [font]: advances } = ADVANCE_WIDTHS;

	return Math.max(...advances);
};

const advanceOf = (character: string, font: Font): number => {
	const code = character.codePointAt(ONLY_CHARACTER);

	if (code === undefined || code < FIRST_CODE || code > LAST_CODE) {
		return widestAdvance(font);
	}

	const { [font]: advances } = ADVANCE_WIDTHS;
	const { [code - FIRST_CODE]: advance } = advances;

	return advance ?? widestAdvance(font);
};

// The width of the ink, which is what has to fit inside a region.
const widthOf = (text: string, font: Font): number => {
	let advances = NO_INK;

	for (const character of text) {
		advances += advanceOf(character, font);
	}

	return advances === NO_INK ? NO_INK : advances - GLYPH_SPACING;
};

// Where a string's ink sits vertically, in rows below the element's y.
//
// A string with no ink at all -- a blank line -- has no extent to speak of, so
// it falls back to the font's nominal box, which keeps it lined up with the
// lines around it.
interface InkBox {
	readonly top: number;
	readonly bottom: number;
}

const inkRowsOf = (character: string, font: Font): InkBox | undefined => {
	const { [font]: groups } = INK_ROWS;
	const group = groups.find(([, , characters]) =>
		characters.includes(character),
	);

	if (group === undefined) {
		return undefined;
	}

	const [top, bottom] = group;

	return { top, bottom };
};

// A box counts the first and last row it covers, so its height includes both.
const ROWS_INCLUSIVE = 1;

const inkBoxOf = (text: string, font: Font): InkBox => {
	const {
		[font]: { inkTop, lineHeight },
	} = FONT_METRICS;

	let top = Infinity;
	let bottom = -Infinity;

	for (const character of text) {
		const box = inkRowsOf(character, font);

		if (box !== undefined) {
			top = Math.min(top, box.top);
			bottom = Math.max(bottom, box.bottom);
		}
	}

	if (bottom < top) {
		return { top: inkTop, bottom: inkTop + lineHeight - ROWS_INCLUSIVE };
	}

	return { top, bottom };
};

// The rows a string occupies down to its baseline, ignoring any tail below it.
//
// This is what a line of text should be centred on. The eye reads the band
// between the tops of the letters and the line they stand on; a descender is a
// tail hanging off that, not part of the mass being balanced. Centring the
// full ink instead moves every word up or down according to whether it happens
// to contain a "g", so two blocks drawn in the same font sit at two different
// heights -- which is exactly what it looks like: wrong.
//
// For a string with no descender the band and the ink are the same thing, so
// this is not a special case for descenders. It is simply where the text goes.
const capBandOf = (text: string, font: Font): InkBox => {
	const {
		[font]: { baseline },
	} = FONT_METRICS;
	const { top, bottom } = inkBoxOf(text, font);

	return { top, bottom: Math.min(bottom, baseline) };
};

// The countdown element has a face of its own, and no font option, so its size
// is fixed and had to be measured the same way. It is monospaced: every digit
// occupies three pixels, and the whole thing is one of exactly two widths
// depending on whether the hours are showing.
// Its box carries two pixels of padding past the last digit, which is only
// visible when the element is right-aligned: an anchor at x puts the ink's
// right edge at x - 2.
const COUNTDOWN_METRICS = {
	// MM:SS
	width: 17,
	// HH:MM:SS
	widthWithHours: 27,
	inkTop: 2,
	inkHeight: 5,
	inkRight: 2,
} as const;

export {
	COUNTDOWN_METRICS,
	FONTS_BY_SIZE,
	FONT_METRICS,
	GLYPH_SPACING,
	INK_ROWS,
	ROWS_INCLUSIVE,
	SMALLEST_FONT,
	capBandOf,
	inkBoxOf,
	widthOf,
};
export type { Font, FontMetrics, InkBox };
