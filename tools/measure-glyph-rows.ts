// Measures the rows each glyph's ink occupies, per font, relative to the y an
// element is drawn at. Grouped into runs of characters that share an extent,
// because most of them do.
//
// This is what lets a line of text be centred on the ink it actually has
// rather than on the font's nominal box: "Email" has no descender and would
// otherwise be pushed high by space reserved for one.
//
// Run with `node tools/measure-glyph-rows.ts`. Not part of the build.

import { BusyBar } from "@busy-app/busy-lib";
import { DEVICE_ADDRESS } from "../src/config.ts";

const WIDTH = 72;
const HEIGHT = 16;
const CHANNELS = 4;
const APP = "measure";

const FONTS = ["tiny", "small", "normal", "bold", "large"] as const;

// Drawn a few rows down so a glyph reaching above the element's y stays on
// screen, and taken back off the measurement afterwards.
const DRAW_Y = 3;

// Wider than the widest glyph in any font, so each column holds exactly one.
const COLUMN = 14;
const COLUMNS = 5;

const bar = new BusyBar({ addr: DEVICE_ADDRESS });

const sleep = async (ms: number): Promise<void> =>
	await new Promise((resolve) => setTimeout(resolve, ms));

const measure = async (
	characters: string[],
	font: string,
): Promise<Array<[number, number]>> => {
	await bar.DisplayClear({ application_name: APP });
	await sleep(60);
	await bar.DisplayDraw({
		application_name: APP,
		priority: 60,
		elements: characters.map((character, index) => ({
			id: `c${String(index)}`,
			type: "text" as const,
			text: character,
			font: font as never,
			color: "#FFFFFFFF",
			display: "front" as const,
			align: "top_left" as const,
			x: index * COLUMN,
			y: DRAW_Y,
			timeout: 0,
		})),
	});
	await sleep(250);

	const frame = await bar.DisplayScreenFrameGet(
		{ display: 0 },
		{ dataType: "binary", format: "rgba" },
	);

	if (frame === undefined) {
		throw new Error("no frame came back");
	}

	return characters.map((_character, index) => {
		let top = Infinity;
		let bottom = -Infinity;

		for (let y = 0; y < HEIGHT; y += 1) {
			for (let x = index * COLUMN; x < (index + 1) * COLUMN; x += 1) {
				const offset = (y * WIDTH + x) * CHANNELS;
				const r = frame[offset] ?? 0;
				const g = frame[offset + 1] ?? 0;
				const b = frame[offset + 2] ?? 0;

				if (Math.max(r, g, b) >= 24) {
					top = Math.min(top, y);
					bottom = Math.max(bottom, y);
				}
			}
		}

		return bottom < top ? [0, 0] : [top - DRAW_Y, bottom - DRAW_Y];
	});
};

const printable: string[] = [];

for (let code = 0x21; code <= 0x7e; code += 1) {
	printable.push(String.fromCharCode(code));
}

for (const font of FONTS) {
	const extents = new Map<string, string>();

	for (let i = 0; i < printable.length; i += COLUMNS) {
		const batch = printable.slice(i, i + COLUMNS);
		const measured = await measure(batch, font);

		batch.forEach((character, index) => {
			const [top, bottom] = measured[index] ?? [0, 0];
			const key = `${String(top)},${String(bottom)}`;

			extents.set(key, (extents.get(key) ?? "") + character);
		});
	}

	const grouped = [...extents.entries()]
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([key, characters]) => `[${key},${JSON.stringify(characters)}]`)
		.join(", ");

	process.stdout.write(`${font}: [${grouped}],\n`);
}

await bar.DisplayClear({ application_name: APP });
