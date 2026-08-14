// Draws the event program on the real device for a set of made-up
// appointments and prints back what the bar actually shows, so the alert
// layout can be judged without waiting for a real meeting to come round.
//
//   node tools/preview-event.ts
//
// The appointments it invents go in a temporary directory, never in `local/`.
// A fabricated calendar sitting where a real one lives is indistinguishable
// from the real one at a glance -- and the moment anybody believes it, every
// conclusion drawn from the bar is about nothing. Names here are prefixed so
// that even a stray screenshot says what it is. Not part of the build.
//
// This draws at the event program's own priority, which outranks everything
// including a BUSY session, and clears up after itself on the way out.

import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BusyBar } from "@busy-app/busy-lib";
import { loadConfig } from "../src/config/index.ts";
import { createSection } from "../src/config/section.ts";
import { MS_PER_SECOND } from "../src/constants/time.ts";
import { ALERT_PRIORITY, event } from "../src/programs/event/index.ts";

const WIDTH = 72;
const HEIGHT = 16;
const CHANNELS = 4;

const directory = await mkdtemp(join(tmpdir(), "busybar-preview-event-"));
const CALENDAR_FILE = join(directory, "made-up-appointments.ics");

// The real config file is read -- it is where the address of the bar is -- but
// the address is the only thing taken from it. What the program is told is
// made up below, so the calendars configured for `event` are left alone.
const { deviceAddress } = await loadConfig();
const bar = new BusyBar({ addr: deviceAddress });

const sleep = async (ms: number): Promise<void> =>
	await new Promise((resolve) => setTimeout(resolve, ms));

const stamp = (date: Date): string =>
	`${date.toISOString().replace(/[:\-]/g, "").split(".")[0]}Z`;

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
			} else if (b > r && b > g) {
				row += "B";
			} else if (r > 128 && g > 96 && b < 96) {
				// The alert colour: yellow is red and green together.
				row += "Y";
			} else {
				row += "#";
			}
		}

		rows.push(row);
	}

	// The frame is two pixels thick, so the inside runs from row 2 to row 13.
	return `${rows.map((row, y) => `${String(y).padStart(2)} ${row}`).join("\n")}`;
};

// Each case is a name, how many seconds until the appointment starts, and
// whether it is somewhere to be -- which decides the lead, and therefore
// whether it is alerting at all. A case further out than its own lead draws
// nothing, so anything more than five minutes away has to be located.
//
// The names say what they are testing rather than impersonating a real day.
// They still have to be the right shape -- a length, a descender or not, a word
// too long to break -- because shape is the whole of what is being looked at.
const CASES: Array<[string, number, boolean]> = [
	// Short, and the shape a real title takes.
	["TEST", 299, false],
	["TEST Standup", 299, false],
	["TEST Located 13:15", 299, false],
	// A tail, and the same length without one: these should sit on the same
	// baseline as each other, which they did not before the gap row was lent
	// to descenders.
	["TEST tail g", 299, false],
	["TEST no tail", 299, false],
	// Long enough to be cut, which should end in an ellipsis rather than
	// silently losing the end.
	["TEST a name far too long to hold in full at any size", 299, false],
	["TESTing a supercalifragilisticexpialidocious word", 299, false],
	// The digits the caption has to hold: the widest minutes it can reach,
	// and seconds only. The first is half an hour out, so it has to be
	// somewhere to be or it would not be alerting yet.
	["TEST wide clock", 1799, true],
	["TEST narrow clock", 29, false],
];

const context = {
	bar,
	config: createSection("preview", "programs.event", {
		calendars: [CALENDAR_FILE],
	}),
	applicationName: event.name,
	priority: ALERT_PRIORITY,
	log: (message: string) => {
		console.log(`  ${message}`);
	},
};

try {
	for (const [name, secondsAway, located] of CASES) {
		const start = new Date(Date.now() + secondsAway * MS_PER_SECOND);

		await writeFile(
			CALENDAR_FILE,
			[
				"BEGIN:VCALENDAR",
				"VERSION:2.0",
				"PRODID:-//busybar//PREVIEW -- NOT A REAL CALENDAR//EN",
				"BEGIN:VEVENT",
				"UID:preview@busybar.invalid",
				`DTSTAMP:${stamp(new Date())}`,
				`DTSTART:${stamp(start)}`,
				...(located ? ["LOCATION:TEST Room 4"] : []),
				`SUMMARY:${name}`,
				"END:VEVENT",
				"END:VCALENDAR",
				"",
			].join("\r\n"),
			"utf8",
		);

		// Cleared first, so a case that draws nothing comes back blank rather
		// than showing the previous one's frame. A stale capture that looks
		// like a fresh one is worse than no capture: it is the whole reason
		// this prints the pixels rather than trusting the code.
		await bar.DisplayClear({ application_name: event.name });
		await sleep(200);

		await event.draw(context);

		// The device needs a moment to put the elements up before the frame is
		// worth reading back.
		await sleep(400);

		console.log(`\n${name}  (starts in ${String(secondsAway)}s)`);
		console.log(await capture());
	}
} finally {
	await bar.DisplayClear({ application_name: event.name });
	await rm(directory, { recursive: true, force: true });
}
