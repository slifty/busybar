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
//
// It makes a noise. Any case inside the sound's thirty-second lead chimes,
// because the program is being run rather than imitated -- which is the point of
// the tool, and worth knowing before running it in a room with other people in
// it.

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

// Each case is a name and how many seconds until the appointment starts. What
// is being looked at is pixels rather than policy, so the lead below is set
// wide enough that every case draws something -- an alert that has not opened
// yet is a blank frame, which says nothing about the layout.
//
// The names say what they are testing rather than impersonating a real day.
// They still have to be the right shape -- a length, a descender or not, a word
// too long to break -- because shape is the whole of what is being looked at.
const CASES: Array<[string, number]> = [
	// Short, and the shape a real title takes.
	["TEST", 299],
	["TEST Standup", 299],
	["TEST Located 13:15", 299],
	// A tail, and the same length without one: these should sit on the same
	// baseline as each other, which they did not before the gap row was lent
	// to descenders.
	["TEST tail g", 299],
	["TEST no tail", 299],
	// Long enough to be cut, which should end in an ellipsis rather than
	// silently losing the end.
	["TEST a name far too long to hold in full at any size", 299],
	["TESTing a supercalifragilisticexpialidocious word", 299],
	// The digits the caption has to hold: the widest minutes it can reach, and
	// seconds only. The first is half an hour out, which only draws because of
	// the wide lead above.
	["TEST wide clock", 1799],
	["TEST narrow clock", 29],
	// Past its start and still up, which is what an unacknowledged chiming
	// alert looks like: the device clamps the countdown at 00:00 rather than
	// counting negative.
	["TEST clamped clock", -30],
];

const context = {
	bar,
	config: createSection("preview", "programs.event", {
		calendars: [CALENDAR_FILE],
		// Wide enough that every case above has an open window. The program's
		// own default is five minutes; this is about seeing the layout rather
		// than about when an alert is due.
		lead: 30,
	}),
	applicationName: event.name,
	priority: ALERT_PRIORITY,
	log: (message: string) => {
		console.log(`  ${message}`);
	},
	// Nothing here is running alongside anything else.
	redraw: () => undefined,
	releaseScreen: () => undefined,
};

try {
	for (const [name, secondsAway] of CASES) {
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

		// Started rather than only drawn, because reading the calendars is
		// `start`'s job and `draw` uses whatever was last read. Each case writes
		// a different calendar, so each case is its own run.
		await event.start?.(context);
		await event.draw(context);

		// The device needs a moment to put the elements up before the frame is
		// worth reading back.
		await sleep(400);

		console.log(
			secondsAway < 0
				? `\n${name}  (started ${String(-secondsAway)}s ago)`
				: `\n${name}  (starts in ${String(secondsAway)}s)`,
		);
		console.log(await capture());
	}
} finally {
	await bar.DisplayClear({ application_name: event.name });
	await rm(directory, { recursive: true, force: true });
}
