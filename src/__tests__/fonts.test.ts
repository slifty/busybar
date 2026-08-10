import { describe, expect, it } from "vitest";
import {
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
} from "../fonts.ts";

const PRINTABLE = Array.from({ length: 0x7e - 0x20 + 1 }, (_unused, index) =>
	String.fromCharCode(0x20 + index),
);

const WITH_INK = PRINTABLE.filter((character) => character !== " ");

describe("the font tables", () => {
	it.each(FONTS_BY_SIZE)("covers every printable character in %s", (font) => {
		const { [font]: groups } = INK_ROWS;
		const measured = groups.map(([, , characters]) => characters).join("");

		// Every character exactly once: nothing missing, nothing in two
		// groups claiming different rows.
		expect(measured).toHaveLength(WITH_INK.length);

		for (const character of WITH_INK) {
			expect(measured).toContain(character);
			expect(widthOf(character, font)).toBeGreaterThan(0);
		}
	});

	// The nominal box is what lines are spaced by, and it is only meaningful
	// if it matches the glyphs it claims to describe: the top of a capital and
	// the bottom of a descender.
	it.each(FONTS_BY_SIZE)(
		"has a nominal box matching the glyphs in %s",
		(font) => {
			const {
				[font]: { inkTop, lineHeight },
			} = FONT_METRICS;

			expect(inkBoxOf("A", font).top).toBe(inkTop);
			expect(inkBoxOf("g", font).bottom).toBe(
				inkTop + lineHeight - ROWS_INCLUSIVE,
			);
		},
	);

	// The baseline is what text is centred on, so it has to be the row the
	// letters really sit on rather than a number that drifted from the table.
	it.each(FONTS_BY_SIZE)("has a baseline the letters sit on in %s", (font) => {
		const {
			[font]: { baseline },
		} = FONT_METRICS;

		for (const character of "ABCXYZ0189acemnorsuvwxz") {
			expect(inkBoxOf(character, font).bottom).toBe(baseline);
		}

		for (const character of "gpqy") {
			expect(inkBoxOf(character, font).bottom).toBeGreaterThan(baseline);
		}
	});

	it("names the smallest font as the end of the ladder", () => {
		expect(FONTS_BY_SIZE.at(-1)).toBe(SMALLEST_FONT);
	});

	// Widths have to add up, or fitting text into a region is guesswork: the
	// second copy of a character costs exactly its advance, which is its ink
	// plus the spacing that follows it.
	it.each(FONTS_BY_SIZE)("measures widths that add up in %s", (font) => {
		for (const character of PRINTABLE) {
			expect(widthOf(character + character, font)).toBe(
				2 * widthOf(character, font) + GLYPH_SPACING,
			);
		}
	});

	it("has no width for no text", () => {
		for (const font of FONTS_BY_SIZE) {
			expect(widthOf("", font)).toBe(0);
		}
	});

	// A character the tables do not cover cannot be drawn at all, so the only
	// useful answer is a cautious one -- never an underestimate that would let
	// something overflow its region.
	it.each(FONTS_BY_SIZE)(
		"errs wide on an unmeasured character in %s",
		(font) => {
			const unmeasured = widthOf("é", font);

			for (const character of PRINTABLE) {
				expect(unmeasured).toBeGreaterThanOrEqual(widthOf(character, font));
			}
		},
	);
});

describe("inkBoxOf", () => {
	it("spans every glyph in the string", () => {
		const box = inkBoxOf("Ag", "normal");

		expect(box.top).toBe(inkBoxOf("A", "normal").top);
		expect(box.bottom).toBe(inkBoxOf("g", "normal").bottom);
	});

	it("reports a string with no ink as the nominal box, so a blank line still lines up", () => {
		const {
			normal: { inkTop, lineHeight },
		} = FONT_METRICS;

		expect(inkBoxOf(" ", "normal")).toStrictEqual({
			top: inkTop,
			bottom: inkTop + lineHeight - ROWS_INCLUSIVE,
		});
	});
});

describe("capBandOf", () => {
	it("stops at the baseline, leaving the tail out of it", () => {
		const band = capBandOf("Rugela", "bold");
		const ink = inkBoxOf("Rugela", "bold");

		expect(band.top).toBe(ink.top);
		expect(band.bottom).toBe(FONT_METRICS.bold.baseline);
		expect(ink.bottom).toBeGreaterThan(band.bottom);
	});

	// Which is why nothing about this is a special case for descenders: with no
	// tail to leave out, the band is the ink.
	it("is the whole of the ink when there is no tail", () => {
		expect(capBandOf("Notes", "bold")).toStrictEqual(inkBoxOf("Notes", "bold"));
	});
});

describe("the countdown metrics", () => {
	// Both widths are drawn by the device from the same monospaced face, and
	// the hours are what make the difference between them.
	it("is wider with the hours showing", () => {
		expect(COUNTDOWN_METRICS.widthWithHours).toBeGreaterThan(
			COUNTDOWN_METRICS.width,
		);
	});
});
