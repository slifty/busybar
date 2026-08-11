// Measures the advance width of every printable ASCII character in each font,
// by drawing it on the device and reading the frame back.
//
// Advance is derived as width("cc") - width("c"), which cancels the glyph's
// side bearings instead of assuming they are zero. Space carries no ink, so it
// comes from width("A A") - width("AA") instead.
//
// Run with `node tools/measure-fonts.ts`. Not part of the build.

import { BusyBar } from "@busy-app/busy-lib";
import { loadConfig } from "../src/config/index.ts";

const WIDTH = 72;
const HEIGHT = 16;
const CHANNELS = 4;
const APP = "measure";

const FONTS = ["tiny", "small", "normal", "bold", "large"] as const;

const FIRST_CODE = 0x20;
const LAST_CODE = 0x7e;

const { deviceAddress } = await loadConfig();
const bar = new BusyBar({ addr: deviceAddress });

const sleep = async (ms: number): Promise<void> =>
	await new Promise((resolve) => setTimeout(resolve, ms));

const captureWidths = async (
	slots: Array<{ text: string; x: number; width: number }>,
	font: string,
): Promise<number[]> => {
	await bar.DisplayClear({ application_name: APP });
	await sleep(60);
	await bar.DisplayDraw({
		application_name: APP,
		priority: 60,
		elements: slots.map((slot, index) => ({
			id: `s${String(index)}`,
			type: "text" as const,
			text: slot.text,
			font: font as never,
			color: "#FFFFFFFF",
			display: "front" as const,
			align: "top_left" as const,
			x: slot.x,
			y: 0,
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

	return slots.map((slot) => {
		let min = Infinity;
		let max = -Infinity;

		for (let y = 0; y < HEIGHT; y += 1) {
			for (let x = slot.x; x < slot.x + slot.width; x += 1) {
				const offset = (y * WIDTH + x) * CHANNELS;
				const r = frame[offset] ?? 0;
				const g = frame[offset + 1] ?? 0;
				const b = frame[offset + 2] ?? 0;

				if (Math.max(r, g, b) >= 24) {
					min = Math.min(min, x);
					max = Math.max(max, x);
				}
			}
		}

		return max < min ? 0 : max - min + 1;
	});
};

// Wide enough for the widest double in the largest font, with room to spare.
const SLOT_WIDTH = 24;
const SLOTS_PER_FRAME = 3;

const measureAll = async (
	texts: string[],
	font: string,
): Promise<Map<string, number>> => {
	const widths = new Map<string, number>();

	for (let i = 0; i < texts.length; i += SLOTS_PER_FRAME) {
		const batch = texts.slice(i, i + SLOTS_PER_FRAME);
		const slots = batch.map((text, index) => ({
			text,
			x: index * SLOT_WIDTH,
			width: SLOT_WIDTH,
		}));

		const measured = await captureWidths(slots, font);

		batch.forEach((text, index) => {
			widths.set(text, measured[index] ?? 0);
		});
	}

	return widths;
};

const chars: string[] = [];

for (let code = FIRST_CODE; code <= LAST_CODE; code += 1) {
	chars.push(String.fromCharCode(code));
}

const printable = chars.filter((char) => char !== " ");

for (const font of FONTS) {
	const singles = await measureAll(printable, font);
	const doubles = await measureAll(
		printable.map((char) => char + char),
		font,
	);
	const spacing = await measureAll(["AA", "A A"], font);

	const spaceAdvance = (spacing.get("A A") ?? 0) - (spacing.get("AA") ?? 0);

	const advances = chars.map((char) => {
		if (char === " ") {
			return spaceAdvance;
		}

		return (doubles.get(char + char) ?? 0) - (singles.get(char) ?? 0);
	});

	process.stdout.write(`${font}: ${JSON.stringify(advances)}\n`);
}

await bar.DisplayClear({ application_name: APP });
