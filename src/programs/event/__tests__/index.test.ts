import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { BUSY_SESSION_PRIORITY } from "../../../constants/device.ts";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../../../constants/time.ts";
import { COUNTDOWN_METRICS, FONT_METRICS } from "../../../fonts.ts";
import { createFakeBar } from "../../../test/bar.ts";
import { sectionOf } from "../../../test/config.ts";
import { ALERT_COLOR } from "../appointment.ts";
import { ALERT_PRIORITY, IDLE_REFRESH_MS, event } from "../index.ts";
import type { BusyBar } from "@busy-app/busy-lib";
import type { ProgramContext } from "../../../program.ts";
import type { FakeBar } from "../../../test/bar.ts";

type Elements = Parameters<BusyBar["DisplayDraw"]>[0]["elements"];
type Element = Elements[number];

const isText = (
	element: Element,
): element is Extract<Element, { type: "text" }> => element.type === "text";

const isCountdown = (
	element: Element,
): element is Extract<Element, { type: "countdown" }> =>
	element.type === "countdown";

const isRectangle = (
	element: Element,
): element is Extract<Element, { type: "rectangle" }> =>
	element.type === "rectangle";

// The name is drawn as one element per line, so what it says is the lines put
// back together.
//
// Selected by id rather than by being text, because the caption under the name
// is text too -- and a helper that swept it up would have every assertion about
// the name quietly also asserting the caption.
const NAME_ID_PREFIX = "event-name";
const STARTS_IN_ID = "event-starts-in";

const drawnName = (elements: Elements): string =>
	elements
		.filter(isText)
		.filter(({ id }) => id.startsWith(NAME_ID_PREFIX))
		.map(({ text }) => text)
		.join(" ")
		.trim();

const caption = (elements: Elements) =>
	elements.filter(isText).find(({ id }) => id === STARTS_IN_ID);

const unixSeconds = (date: Date): string =>
	String(Math.ceil(date.getTime() / MS_PER_SECOND));

// Calendars are written to a real temporary directory rather than to a mocked
// `fs`, for the same reason the focus suites do it: reading a source is most of
// the job, so faking it would leave the part worth testing untested.
//
// Never `local/`, and every title says TEST -- an invented calendar sitting
// where a real one lives, or wearing a name a real meeting could have, is one
// glance away from being believed.
const directory = mkdtempSync(join(tmpdir(), "busybar-event-test-"));

const calendarAt = async (name: string, ...body: string[]): Promise<string> => {
	const path = join(directory, name);

	await writeFile(
		path,
		[
			"BEGIN:VCALENDAR",
			"VERSION:2.0",
			"PRODID:-//busybar//test//EN",
			...body,
			"END:VCALENDAR",
		].join("\r\n"),
		"utf8",
	);

	return path;
};

const timedEvent = (
	uid: string,
	summary: string,
	start: string,
	extra: string[] = [],
): string[] => [
	"BEGIN:VEVENT",
	`UID:${uid}@busybar.test`,
	`DTSTART:${start}`,
	...extra,
	`SUMMARY:${summary}`,
	"END:VEVENT",
];

const contextFor = (fake: FakeBar, calendars: string[]): ProgramContext => ({
	bar: fake.bar,
	config: sectionOf({ calendars }),
	applicationName: event.name,
	priority: ALERT_PRIORITY,
	log: () => undefined,
});

// Anything reading `new Date()` gets a fixed clock. Timers are deliberately
// not faked wholesale, which would stall the real file reads these await.
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
	vi.useRealTimers();
});

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

describe("event", () => {
	it("outranks even an active work session, which is the point of it", () => {
		expect(event.priority).toBe(ALERT_PRIORITY);
		expect(ALERT_PRIORITY).toBeGreaterThan(BUSY_SESSION_PRIORITY);
	});

	// Silence is what this program looks like when nothing is coming up, so a
	// program watching nothing is indistinguishable from a working one.
	it("refuses to start with no calendars, saying which setting to fix", async () => {
		const fake = createFakeBar();

		await expect(event.start?.(contextFor(fake, []))).rejects.toThrow(
			/no appointment calendars/v,
		);
	});
});

describe("drawing an alert", () => {
	// Three minutes before a call, so it is inside its five minute window.
	it("draws the name and a countdown to the start", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"call.ics",
			...timedEvent("call", "TEST Call", "20260102T100000Z", [
				"URL:https://example.test/call",
			]),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		const elements = fake.draws[0]?.elements ?? [];

		expect(drawnName(elements)).toBe("TEST Call");
		expect(elements.find(isCountdown)?.timestamp).toBe(
			unixSeconds(new Date("2026-01-02T10:00:00Z")),
		);
	});

	// The caption says what the digits are counting to. Without it a bare clock
	// under a name reads as how long the thing lasts, which is what `focus`
	// means by the same shape and the opposite of what this means.
	it("captions the countdown so the digits cannot be misread", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"caption.ics",
			...timedEvent("caption", "TEST Caption", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		expect(caption(fake.draws[0]?.elements ?? [])?.text).toBe("in");
	});

	// The frame is the interruption, so it is drawn heavier than the hairline a
	// focus block wears.
	it("draws a two pixel frame", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"frame.ics",
			...timedEvent("frame", "TEST Frame", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		expect(
			(fake.draws[0]?.elements ?? []).find(isRectangle)?.border_width,
		).toBe(2);
	});

	// The name has the whole width now that nothing shares its row, and one
	// line of it: four rows is what is left once the frame, the padding and the
	// immovable five rows of digits are paid for.
	it("gives the name the full width, on one line", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"width.ics",
			...timedEvent("width", "TEST Standup", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		const named = (fake.draws[0]?.elements ?? [])
			.filter(isText)
			.filter(({ id }) => id.startsWith(NAME_ID_PREFIX));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Standup");
		expect(named).toHaveLength(1);
	});

	// A name it cannot hold says so rather than stopping mid-word, which is the
	// difference between "there was more" and a title that looks complete and
	// is not.
	it("marks a name it had to cut rather than losing the end quietly", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"cut.ics",
			...timedEvent(
				"cut",
				"TEST a name far too long to hold at any size",
				"20260102T100000Z",
			),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toMatch(/\.\.\.$/v);
	});

	// The word and the digits share a *baseline*, not a top -- they are
	// different heights, so aligning their tops would sit the word a row high.
	// Asserting equal `y` would pass by luck for any two fonts that happened to
	// share an ink offset, which is exactly what it used to do.
	it("sits the caption's word and digits on a shared baseline", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"baseline.ics",
			...timedEvent("baseline", "TEST Baseline", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		const elements = fake.draws[0]?.elements ?? [];
		const label = caption(elements);
		const countdown = elements.find(isCountdown);

		const labelBaseline = (label?.y ?? 0) + FONT_METRICS.tiny.baseline;
		const digitsBottom =
			(countdown?.y ?? 0) +
			COUNTDOWN_METRICS.inkTop +
			COUNTDOWN_METRICS.inkHeight -
			1;

		expect(labelBaseline).toBe(digitsBottom);
	});

	// The padding is the whole point of the row budget above: nothing may be
	// drawn on the row next to the frame, on any side.
	it("keeps a clear row between the frame and everything inside it", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"padding.ics",
			...timedEvent("padding", "TEST Padding", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		const elements = fake.draws[0]?.elements ?? [];
		const countdown = elements.find(isCountdown);
		const digitsBottom =
			(countdown?.y ?? 0) +
			COUNTDOWN_METRICS.inkTop +
			COUNTDOWN_METRICS.inkHeight -
			1;

		// The frame is two pixels, so rows 14 and 15 are it; row 13 is the
		// padding and nothing may reach it.
		expect(digitsBottom).toBeLessThanOrEqual(12);
	});

	// The gap row under the name is lent to descenders so that a tail does not
	// shove the whole name up a row. Caught by drawing it: before the row was
	// lent, "TEST" came back on rows 3..7 and "TEST Standup" on 2..7, which
	// reads as two alerts a minute apart being drawn at different heights for
	// no reason anybody could see.
	it("draws a name with a tail at the same height as one without", async () => {
		const heightOf = async (name: string): Promise<number | undefined> => {
			const fake = createFakeBar();
			const path = await calendarAt(
				`${name.replace(/[^a-z]/giv, "")}.ics`,
				...timedEvent("tail", name, "20260102T100000Z"),
			);

			vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

			await event.draw(contextFor(fake, [path]));

			return (fake.draws[0]?.elements ?? [])
				.filter(isText)
				.find(({ id }) => id.startsWith(NAME_ID_PREFIX))?.y;
		};

		expect(await heightOf("TEST tail g")).toBe(await heightOf("TEST no tail"));
	});

	// The countdown runs to the start rather than to any end, which is the
	// whole difference between an appointment and a focus block.
	it("counts down rather than up", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"direction.ics",
			...timedEvent("direction", "TEST Direction", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		expect((fake.draws[0]?.elements ?? []).find(isCountdown)?.direction).toBe(
			"time_left",
		);
	});

	// Yellow, and none of the three colours a focus block can be -- so a yellow
	// frame is unambiguously an appointment rather than a phase you had not
	// seen before. Red is spoken for: it means a program has failed.
	it("draws it in the alert colour", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"colour.ics",
			...timedEvent("colour", "TEST Colour", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		const elements = fake.draws[0]?.elements ?? [];

		expect(elements.find(isRectangle)?.border_color).toBe(ALERT_COLOR);
		expect(elements.find(isCountdown)?.color).toBe(ALERT_COLOR);
	});

	// The whole of how an alert ends without a button to acknowledge it: the
	// device is handed the start as an expiry and takes the drawing down
	// itself, on time, even if this process is not around to do it.
	it("expires every element at the appointment's start", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"expiry.ics",
			...timedEvent("expiry", "TEST Expiry", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		const start = unixSeconds(new Date("2026-01-02T10:00:00Z"));
		const elements = fake.draws[0]?.elements ?? [];

		expect(elements.length).toBeGreaterThan(0);

		for (const element of elements) {
			expect(element.display_until).toBe(start);
		}
	});

	it("draws at the program's own priority, under its own name", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"priority.ics",
			...timedEvent("priority", "TEST Priority", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		expect(fake.draws[0]?.priority).toBe(ALERT_PRIORITY);
		expect(fake.draws[0]?.application_name).toBe(event.name);
	});

	// An entry with no duration is one `focus` drops and this program must
	// not: being on time for it is exactly the job.
	it("alerts ahead of an appointment with no duration", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"instant.ics",
			"BEGIN:VEVENT",
			"UID:instant@busybar.test",
			"DTSTART:20260102T100000Z",
			"DTEND:20260102T100000Z",
			"SUMMARY:TEST Instant",
			"END:VEVENT",
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Instant");
	});
});

describe("the lead an appointment gets", () => {
	// Somewhere to physically be, twenty minutes out: already alerting, since
	// travel gets thirty.
	it("is alerting half an hour ahead of somewhere to be", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"located.ics",
			...timedEvent("located", "TEST Located", "20260102T100000Z", [
				"LOCATION:TEST Room 4",
			]),
		);

		vi.setSystemTime(new Date("2026-01-02T09:40:00Z"));

		await event.draw(contextFor(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Located");
	});

	// The same twenty minutes out, for a call: silent, since a link gets five.
	it("is silent twenty minutes ahead of a call", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"call-lead.ics",
			...timedEvent("call-lead", "TEST Call", "20260102T100000Z", [
				"URL:https://example.test/call",
			]),
		);

		vi.setSystemTime(new Date("2026-01-02T09:40:00Z"));

		await event.draw(contextFor(fake, [path]));

		expect(fake.draws).toStrictEqual([]);
	});
});

describe("when the alert has not opened", () => {
	// Nothing to draw and nothing to clear: the previous alert's elements
	// carried their own expiry, so the device has already taken them down.
	it("draws nothing and waits exactly until the window opens", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"waiting.ics",
			...timedEvent("waiting", "TEST Waiting", "20260102T100000Z"),
		);

		// Ten minutes out, so the window opening is nearer than the idle
		// refresh and is what decides the wait.
		vi.setSystemTime(new Date("2026-01-02T09:50:00Z"));

		const { nextDrawInMs } = await event.draw(contextFor(fake, [path]));

		expect(fake.draws).toStrictEqual([]);
		expect(nextDrawInMs).toBe(5 * MS_PER_MINUTE);
	});

	// A floor on curiosity rather than a poll: it applies only between alerts,
	// where waking costs a read and no device traffic. Without it a meeting
	// added ahead of the one we can see would be missed.
	it("looks again on the idle refresh when the next window is further off", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"distant.ics",
			...timedEvent("distant", "TEST Distant", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:00:00Z"));

		const { nextDrawInMs } = await event.draw(contextFor(fake, [path]));

		// The window opens at 09:55, further off than the refresh will wait.
		expect(nextDrawInMs).toBe(IDLE_REFRESH_MS);
	});

	// A calendar somebody else is writing gains entries on its own, so a day
	// whose appointments are all done still has to be looked at again.
	it("keeps looking with nothing left in the calendar at all", async () => {
		const fake = createFakeBar();
		const path = await calendarAt(
			"done.ics",
			...timedEvent("done", "TEST Done", "20260101T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:00:00Z"));

		const { nextDrawInMs } = await event.draw(contextFor(fake, [path]));

		expect(fake.draws).toStrictEqual([]);
		expect(nextDrawInMs).toBe(IDLE_REFRESH_MS);
	});
});

describe("several calendars", () => {
	it("pools the appointments from all of them", async () => {
		const fake = createFakeBar();
		const work = await calendarAt(
			"work.ics",
			...timedEvent("work", "TEST Work", "20260102T110000Z"),
		);
		const personal = await calendarAt(
			"personal.ics",
			...timedEvent("personal", "TEST Personal", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(contextFor(fake, [work, personal]));

		// The ten o'clock is the one alerting; the eleven o'clock is not yet.
		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Personal");
	});

	// Carrying on with three calendars out of four means a bar that is
	// confidently silent about a meeting it never saw, and silence is what this
	// program looks like when it is working.
	it("fails the read rather than going quiet about one feed", async () => {
		const fake = createFakeBar();
		const good = await calendarAt(
			"good.ics",
			...timedEvent("good", "TEST Good", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await expect(
			event.draw(contextFor(fake, [good, join(directory, "missing.ics")])),
		).rejects.toThrow(/could not read/v);
	});
});

describe("when two alerts overlap", () => {
	// A place across town starts warning at half past; a call at a quarter to
	// starts warning at twenty to. At twenty to, the call is the thing about to
	// be missed.
	const OVERLAPPING = [
		...timedEvent("across-town", "TEST Across Town", "20260102T100000Z", [
			"LOCATION:TEST Room 4",
		]),
		...timedEvent("call", "TEST Call", "20260102T094500Z", [
			"URL:https://example.test/call",
		]),
	];

	it("gives the screen to whichever starts soonest", async () => {
		const fake = createFakeBar();
		const path = await calendarAt("overlap.ics", ...OVERLAPPING);

		vi.setSystemTime(new Date("2026-01-02T09:41:00Z"));

		await event.draw(contextFor(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Call");
	});

	// Which is what stops it sleeping through the sooner alert while the longer
	// one is up.
	it("wakes when the sooner alert opens, not when the current one ends", async () => {
		const fake = createFakeBar();
		const path = await calendarAt("wake.ics", ...OVERLAPPING);

		vi.setSystemTime(new Date("2026-01-02T09:35:00Z"));

		const { nextDrawInMs } = await event.draw(contextFor(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Across Town");
		expect(nextDrawInMs).toBe(5 * MS_PER_MINUTE);
	});

	// And takes it back once the sooner one has begun and stopped alerting.
	it("returns to the longer alert once the sooner one has started", async () => {
		const fake = createFakeBar();
		const path = await calendarAt("return.ics", ...OVERLAPPING);

		vi.setSystemTime(new Date("2026-01-02T09:46:00Z"));

		await event.draw(contextFor(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Across Town");
	});
});
