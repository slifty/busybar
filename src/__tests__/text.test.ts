import { describe, expect, it } from "vitest";
import {
	FONTS_BY_SIZE,
	FONT_METRICS,
	capBandOf,
	inkBoxOf,
	widthOf,
} from "../fonts.ts";
import { fitText, maxLinesIn } from "../text.ts";
import type { Font } from "../fonts.ts";
import type { FittedText, Region } from "../text.ts";

// The region the focus program actually has for a block name -- ten rows
// inside a frame and its padding, with one of the padding rows lent to
// descenders -- and the whole display, which is what a failure gets.
const NAME_REGION: Region = { width: 47, height: 10, tailRoom: 1 };
const TAIL_ROOM = NAME_REGION.tailRoom ?? 0;
const DISPLAY: Region = { width: 72, height: 16 };

// Named for the shape each one is testing rather than for a working day.
// Shape is all that matters here -- a length, a tail, a word too long to
// break -- and a fixture wearing a real title is one screenshot away from
// being mistaken for a real schedule.
const NAMES = [
	"TEST",
	"TEST tail p",
	"TEST 1:1",
	"TEST wraps here",
	"TEST a name that needs a second line",
	"TEST a name far too long to hold in full at any size",
	"TESTsupercalifragilisticexpialidocious",
	"...",
	"x",
];

const said = ({ lines }: FittedText): string =>
	lines
		.map(({ text }) => text)
		.join(" ")
		.trim();

const spanOf =
	(boxOf: (text: string, font: Font) => { top: number; bottom: number }) =>
	({ font, lines }: FittedText): [number, number] => {
		const tops = lines.map(({ text, y }) => y + boxOf(text, font).top);
		const bottoms = lines.map(({ text, y }) => y + boxOf(text, font).bottom);

		return [Math.min(...tops), Math.max(...bottoms)];
	};

// Everything the region has to hold, tails included.
const inkSpan = spanOf(inkBoxOf);

// What the centring balances: the letters down to the line they stand on.
const bandSpan = spanOf(capBandOf);

const sizeOf = (font: Font): number => FONTS_BY_SIZE.indexOf(font);

describe("fitText", () => {
	it("takes the largest font a short name fits in", () => {
		expect(fitText("TEST", NAME_REGION).font).toBe("large");
	});

	it("reaches for a smaller one only when it has to", () => {
		const roomy = fitText("TEST tail p", { width: 72, height: 14 });
		const tight = fitText("TEST tail p", { width: 40, height: 14 });

		expect(sizeOf(tight.font)).toBeGreaterThan(sizeOf(roomy.font));
	});

	// The property that matters: nothing is ever drawn wider than the region
	// it was given, whatever the name and however little room there is.
	it.each(NAMES)("keeps %s inside the region at any width", (name) => {
		for (let width = 8; width <= 72; width += 1) {
			const fitted = fitText(name, { width, height: 14 });

			for (const { text } of fitted.lines) {
				expect(widthOf(text, fitted.font)).toBeLessThanOrEqual(width);
			}
		}
	});

	it.each(NAMES)("keeps %s inside the height it was given", (name) => {
		for (const height of [8, 10, 14, 16]) {
			const fitted = fitText(name, { width: 49, height });
			const [top, bottom] = inkSpan(fitted);

			expect(bottom - top).toBeLessThan(height);
		}
	});

	// The eye balances the band between the tops of the letters and the line
	// they stand on. A tail hanging below that is not part of it.
	it.each(NAMES)("centres %s on its cap band", (name) => {
		const fitted = fitText(name, NAME_REGION);
		const [top, bottom] = bandSpan(fitted);
		const below = NAME_REGION.height - bottom - 1;

		expect(Math.abs(top - below)).toBeLessThanOrEqual(1);
	});

	// Which is the whole point of centring by the band: two blocks drawn in
	// the same font sit at the same height, whatever letters they happen to
	// contain. The two differ by one letter, and only in whether it has a tail.
	it("sits a name with a descender at the same height as one without", () => {
		const withTail = fitText("TEST tail p", NAME_REGION);
		const without = fitText("TEST tail n", NAME_REGION);

		expect(withTail.font).toBe(without.font);
		expect(withTail.lines[0]?.y).toBe(without.lines[0]?.y);
	});

	// A tail may use the row it was lent and not one more.
	it.each(NAMES)(
		"keeps the tail of %s within the room it was given",
		(name) => {
			const fitted = fitText(name, NAME_REGION);
			const [top, bottom] = inkSpan(fitted);

			expect(top).toBeGreaterThanOrEqual(0);
			expect(bottom).toBeLessThan(NAME_REGION.height + TAIL_ROOM);
		},
	);

	// And where nothing was lent, a tail stays strictly inside -- the error
	// drawing has the whole display and no padding to spare.
	it.each(NAMES)("keeps %s inside a region that lent nothing", (name) => {
		const region = { width: NAME_REGION.width, height: NAME_REGION.height };
		const [top, bottom] = inkSpan(fitText(name, region));

		expect(top).toBeGreaterThanOrEqual(0);
		expect(bottom).toBeLessThan(region.height);
	});

	it("breaks at spaces rather than inside words", () => {
		const { lines } = fitText("TEST wraps here", NAME_REGION);

		expect(lines.map(({ text }) => text)).toStrictEqual(["TEST wraps", "here"]);
	});

	it("says the whole of a name it can fit", () => {
		for (const name of ["TEST", "TEST tail p", "TEST wraps here"]) {
			expect(said(fitText(name, NAME_REGION))).toBe(name);
		}
	});

	// When it genuinely cannot fit, the cut is at a space where it can be and
	// the loss is marked, rather than the name being silently clipped.
	it("marks what it had to leave out", () => {
		const fitted = fitText(
			"TEST a name far too long to hold in full at any size",
			NAME_REGION,
		);

		expect(said(fitted)).toMatch(/\.\.\.$/v);
		expect(said(fitted).startsWith("TEST")).toBe(true);
	});

	it("cuts inside a word only when the word cannot fit on its own", () => {
		const fitted = fitText(
			"TESTsupercalifragilisticexpialidocious",
			NAME_REGION,
		);

		expect(said(fitted)).toMatch(/^TESTsuperc/v);
		expect(said(fitted)).toMatch(/\.\.\.$/v);
	});

	// A region with no room for a line of even the smallest font still has to
	// produce something: a blank bar says nothing is wrong.
	it("still draws a line in a region too short for one", () => {
		const fitted = fitText("TEST", { width: 49, height: 3 });

		expect(fitted.lines.length).toBeGreaterThan(0);
	});

	it("uses more lines rather than a smaller font where both would do", () => {
		const { font, lines } = fitText("TEST two words", {
			width: 40,
			height: 14,
		});

		expect(lines).toHaveLength(2);
		expect(font).toBe("small");
	});

	it("never returns more lines than the region can hold", () => {
		for (const name of NAMES) {
			for (const region of [NAME_REGION, DISPLAY]) {
				expect(fitText(name, region).lines.length).toBeLessThanOrEqual(
					maxLinesIn(region.height),
				);
			}
		}
	});
});

describe("maxLinesIn", () => {
	// A caller sizes its element slots by this, so anything smaller would
	// leave a line of a previous drawing stranded on the display.
	it("is at least what any font would use", () => {
		for (const height of [6, 10, 14, 16, 40]) {
			for (const font of FONTS_BY_SIZE) {
				const {
					[font]: { lineHeight },
				} = FONT_METRICS;

				expect(maxLinesIn(height)).toBeGreaterThanOrEqual(
					Math.floor((height + 1) / (lineHeight + 1)),
				);
			}
		}
	});

	it("never promises nothing at all", () => {
		expect(maxLinesIn(1)).toBeGreaterThanOrEqual(1);
	});
});
