// Draws the focus program on the real device for a set of made-up blocks and
// prints back what the bar actually shows, so a layout can be judged without
// waiting for the schedule to reach an interesting moment.
//
//   node tools/preview.ts
//
// The blocks it invents go in a temporary directory, never in `local/`. A
// fabricated schedule sitting where the real one lives is indistinguishable
// from the real one at a glance -- and the moment anybody believes it, every
// conclusion drawn from the bar is about nothing. Names here are prefixed so
// that even a stray screenshot says what it is. Not part of the build.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BusyBar } from "@busy-app/busy-lib";
import { DEVICE_ADDRESS } from "../src/config.ts";
import { MS_PER_MINUTE } from "../src/constants/time.ts";
import { focus } from "../src/programs/focus/index.ts";

const WIDTH = 72;
const HEIGHT = 16;
const CHANNELS = 4;

const directory = await mkdtemp(join(tmpdir(), "busybar-preview-"));
const SCHEDULE_FILE = join(directory, "made-up-schedule.json");

const bar = new BusyBar({ addr: DEVICE_ADDRESS });

const sleep = async (ms: number): Promise<void> =>
	await new Promise((resolve) => setTimeout(resolve, ms));

// Where the ink sits inside a band of columns, so the vertical centring of the
// name can be checked as numbers rather than by eye.
const inkRows = (
	rows: string[],
	from: number,
	to: number,
): [number, number] => {
	let top = Infinity;
	let bottom = -Infinity;

	rows.forEach((row, y) => {
		// The frame itself is not ink worth measuring.
		if (y === 0 || y === rows.length - 1) {
			return;
		}

		for (let x = from; x <= to; x += 1) {
			if (row[x] !== undefined && row[x] !== ".") {
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
			}
		}
	});

	return [top, bottom];
};

const capture = async (): Promise<string> => {
	const frame = await bar.DisplayScreenFrameGet(
		{ display: 0 },
		{ dataType: "binary", format: "rgba" },
	);

	if (frame === undefined) {
		throw new Error("no frame came back");
	}

	const rows: string[] = [];

	for (let y = 0; y < HEIGHT; y += 1) {
		let row = "";

		for (let x = 0; x < WIDTH; x += 1) {
			const offset = (y * WIDTH + x) * CHANNELS;
			const r = frame[offset] ?? 0;
			const g = frame[offset + 1] ?? 0;
			const b = frame[offset + 2] ?? 0;

			if (Math.max(r, g, b) < 24) {
				row += ".";
			} else if (r > g && r > b) {
				row += "R";
			} else if (g > r && g > b) {
				row += "G";
			} else if (b > r && b > g) {
				row += "B";
			} else {
				row += "#";
			}
		}

		rows.push(row);
	}

	// Rows 1..14 are the inside of the frame; columns 2..40 are safely inside
	// the name's half of it, whichever width the countdown took.
	const [top, bottom] = inkRows(rows, 2, 40);

	return `name ink rows ${String(top)}..${String(bottom)} (inside the frame is 1..14, so ${String(top - 1)} above and ${String(14 - bottom)} below)\n${rows.join("\n")}`;
};

// Each case is a name and how many minutes are left of the block, with a start
// far enough back that the phase is whatever the remaining time implies.
//
// The names say what they are testing rather than impersonating a working day.
// They still have to be the right shape -- a length, a descender or not, a word
// too long to break -- because shape is the whole of what is being looked at.
const CASES: Array<[string, number, number]> = [
	// Same length, one with a tail and one without: these should sit on the
	// same baseline, and used not to.
	["TEST tail g", 45, 90],
	["TEST no tail", 45, 90],
	// Short enough for the largest font, and long enough for each step down.
	["TEST", 45, 90],
	["TEST short", 45, 90],
	["TEST medium name", 45, 90],
	["TEST a name that wraps onto two lines", 45, 90],
	["TESTing a supercalifragilisticexpialidocious word", 40, 60],
	// The wide countdown, and the narrow one on a short block.
	["TEST hours", 95, 120],
	["TEST minutes", 8, 15],
];

process.env["BUSYBAR_FOCUS_FILE"] = SCHEDULE_FILE;

// Nothing personal is read: a calendar in the environment would otherwise win
// over the made-up file below.
delete process.env["BUSYBAR_FOCUS_CALENDAR"];

const context = {
	bar,
	applicationName: focus.name,
	log: (message: string): void => {
		process.stdout.write(`${message}\n`);
	},
};

// Whatever happens, the made-up blocks come off the bar and off the disk.
//
// A run that stops half way -- a device unplugged, a pipe closed by `head`,
// a Ctrl-C -- would otherwise leave an invented block on the display with an
// expiry an hour out, and it would sit there looking exactly like a real one.
// That is not hypothetical: it is how an afternoon was lost.
try {
	for (const [name, minutesLeft, lengthMinutes] of CASES) {
		const end = new Date(Date.now() + minutesLeft * MS_PER_MINUTE);
		const start = new Date(end.getTime() - lengthMinutes * MS_PER_MINUTE);

		await writeFile(
			SCHEDULE_FILE,
			JSON.stringify([
				{ name, start: start.toISOString(), end: end.toISOString() },
			]),
			"utf8",
		);

		await bar.DisplayClear({ application_name: focus.name });
		await sleep(120);

		const result = await focus.draw(context);

		await sleep(400);

		process.stdout.write(
			`${name} -- ${String(minutesLeft)}m left of ${String(lengthMinutes)}m, next draw in ${String(Math.round((result.nextDrawInMs ?? 0) / MS_PER_MINUTE))}m\n`,
		);
		process.stdout.write(`${await capture()}\n\n`);
	}
} finally {
	await bar.DisplayClear({ application_name: focus.name });
	await rm(directory, { recursive: true, force: true });

	// Whatever was running before this is not drawing now: its last drawing
	// was cleared above, and a program only draws again when it decides to.
	process.stdout.write(
		"the display is clear -- restart the tool to put the real schedule back\n",
	);
}
