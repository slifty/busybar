import { setTimeout as sleep } from "node:timers/promises";
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
import { MS_PER_MINUTE } from "../../../constants/time.ts";
import { COUNTDOWN_METRICS, FONT_METRICS } from "../../../fonts.ts";
import { createFakeBar } from "../../../test/bar.ts";
import {
	caption,
	contextFor,
	createCalendars,
	startedContext,
	drawnName,
	isCountdown,
	isRectangle,
	nameLines,
	timedEvent,
	unixSeconds,
} from "../../../test/event.ts";
import { ALERT_COLOR } from "../appointment.ts";
import { ALERT_PRIORITY, event } from "../index.ts";
import type { ProgramContext } from "../../../program.ts";
import type { FakeBar } from "../../../test/bar.ts";

// The row the padding sits on: the frame is two pixels, so rows 14 and 15 are
// it and row 13 is the clear one nothing may reach.
const LAST_DRAWABLE_ROW = 12;

const BORDER_THICKNESS = 2;

const calendars = createCalendars();

afterAll(async () => {
	await calendars.forget();
});

// Anything reading `new Date()` gets a fixed clock. Timers are deliberately
// not faked wholesale, which would stall the real file reads these await.
beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
	vi.useRealTimers();
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
		const path = await calendars.write(
			"call.ics",
			...timedEvent("call", "TEST Call", "20260102T100000Z", [
				"URL:https://example.test/call",
			]),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

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
		const path = await calendars.write(
			"caption.ics",
			...timedEvent("caption", "TEST Caption", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect(caption(fake.draws[0]?.elements ?? [])?.text).toBe("in");
	});

	// The frame is the interruption, so it is drawn heavier than the hairline a
	// focus block wears.
	it("draws a two pixel frame", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"frame.ics",
			...timedEvent("frame", "TEST Frame", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect(
			(fake.draws[0]?.elements ?? []).find(isRectangle)?.border_width,
		).toBe(BORDER_THICKNESS);
	});

	// The name has the whole width now that nothing shares its row, and one
	// line of it: four rows is what is left once the frame, the padding and the
	// immovable five rows of digits are paid for.
	it("gives the name the full width, on one line", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"width.ics",
			...timedEvent("width", "TEST Standup", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

		const elements = fake.draws[0]?.elements ?? [];

		expect(drawnName(elements)).toBe("TEST Standup");
		expect(nameLines(elements)).toHaveLength(1);
	});

	// A name it cannot hold says so rather than stopping mid-word, which is the
	// difference between "there was more" and a title that looks complete and
	// is not.
	it("marks a name it had to cut rather than losing the end quietly", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"cut.ics",
			...timedEvent(
				"cut",
				"TEST a name far too long to hold at any size",
				"20260102T100000Z",
			),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toMatch(/\.\.\.$/v);
	});

	// The word and the digits share a *baseline*, not a top -- they are
	// different heights, so aligning their tops would sit the word a row high.
	// Asserting equal `y` would pass by luck for any two fonts that happened to
	// share an ink offset, which is exactly what it used to do.
	it("sits the caption's word and digits on a shared baseline", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"baseline.ics",
			...timedEvent("baseline", "TEST Baseline", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

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

	// The padding is the whole point of the row budget: nothing may be drawn on
	// the row next to the frame, on any side.
	it("keeps a clear row between the frame and everything inside it", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"padding.ics",
			...timedEvent("padding", "TEST Padding", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

		const countdown = (fake.draws[0]?.elements ?? []).find(isCountdown);
		const digitsBottom =
			(countdown?.y ?? 0) +
			COUNTDOWN_METRICS.inkTop +
			COUNTDOWN_METRICS.inkHeight -
			1;

		expect(digitsBottom).toBeLessThanOrEqual(LAST_DRAWABLE_ROW);
	});

	// The gap row under the name is lent to descenders so that a tail does not
	// shove the whole name up a row. Caught by drawing it: before the row was
	// lent, "TEST" came back on rows 3..7 and "TEST Standup" on 2..7, which
	// reads as two alerts a minute apart being drawn at different heights for
	// no reason anybody could see.
	it("draws a name with a tail at the same height as one without", async () => {
		const heightOf = async (name: string): Promise<number | undefined> => {
			const fake = createFakeBar();
			const path = await calendars.write(
				`${name.replace(/[^a-z]/giv, "")}.ics`,
				...timedEvent("tail", name, "20260102T100000Z"),
			);

			vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

			await event.draw(await startedContext(fake, [path]));

			return nameLines(fake.draws[0]?.elements ?? [])[0]?.y;
		};

		expect(await heightOf("TEST tail g")).toBe(await heightOf("TEST no tail"));
	});

	// The countdown runs to the start rather than to any end, which is the
	// whole difference between an appointment and a focus block.
	it("counts down rather than up", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"direction.ics",
			...timedEvent("direction", "TEST Direction", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect((fake.draws[0]?.elements ?? []).find(isCountdown)?.direction).toBe(
			"time_left",
		);
	});

	// Yellow, and none of the three colours a focus block can be -- so a yellow
	// frame is unambiguously an appointment rather than a phase you had not
	// seen before. Red is spoken for: it means a program has failed.
	it("draws it in the alert colour", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"colour.ics",
			...timedEvent("colour", "TEST Colour", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

		const elements = fake.draws[0]?.elements ?? [];

		expect(elements.find(isRectangle)?.border_color).toBe(ALERT_COLOR);
		expect(elements.find(isCountdown)?.color).toBe(ALERT_COLOR);
	});

	it("draws at the program's own priority, under its own name", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"priority.ics",
			...timedEvent("priority", "TEST Priority", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect(fake.draws[0]?.priority).toBe(ALERT_PRIORITY);
		expect(fake.draws[0]?.application_name).toBe(event.name);
	});

	// An entry with no duration is one `focus` drops and this program must
	// not: being on time for it is exactly the job.
	it("alerts ahead of an appointment with no duration", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"instant.ics",
			"BEGIN:VEVENT",
			"UID:instant@busybar.test",
			"DTSTART:20260102T100000Z",
			"DTEND:20260102T100000Z",
			"SUMMARY:TEST Instant",
			"END:VEVENT",
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Instant");
	});
});

describe("the lead an appointment gets", () => {
	// Twenty minutes out and silent, whatever the calendar says about where it
	// is: a room and a link both get five minutes.
	it.each([
		["somewhere to be", "LOCATION:TEST Room 4"],
		["a link", "URL:https://example.test/call"],
	])("is silent twenty minutes ahead of %s", async (_label, property) => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"lead.ics",
			...timedEvent("lead", "TEST Lead", "20260102T100000Z", [property]),
		);

		vi.setSystemTime(new Date("2026-01-02T09:40:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect(fake.draws).toStrictEqual([]);
	});

	it("is alerting five minutes ahead of anything", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"located.ics",
			...timedEvent("located", "TEST Located", "20260102T100000Z", [
				"LOCATION:TEST Room 4",
			]),
		);

		vi.setSystemTime(new Date("2026-01-02T09:56:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Located");
	});

	// How far away somebody's meetings are is a fact about their day, and the
	// file is where a fact like that gets stated.
	it("takes the lead from the file when the file says one", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"configured-lead.ics",
			...timedEvent("configured-lead", "TEST Configured", "20260102T100000Z", [
				"LOCATION:TEST Room 4",
			]),
		);

		vi.setSystemTime(new Date("2026-01-02T09:56:00Z"));

		await event.draw(await startedContext(fake, [path], { lead: 1 }));

		expect(fake.draws).toStrictEqual([]);
	});
});

describe("when the alert has not opened", () => {
	// Nothing to draw and nothing to clear: the previous alert's elements
	// carried their own expiry, so the device has already taken them down.
	it("draws nothing and waits exactly until the window opens", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"waiting.ics",
			...timedEvent("waiting", "TEST Waiting", "20260102T100000Z"),
		);

		// Ten minutes out, so the window opening is nearer than the idle
		// refresh and is what decides the wait.
		vi.setSystemTime(new Date("2026-01-02T09:50:00Z"));

		const { nextDrawInMs } = await event.draw(
			await startedContext(fake, [path]),
		);

		expect(fake.draws).toStrictEqual([]);
		expect(nextDrawInMs).toBe(5 * MS_PER_MINUTE);
	});

	// The wait is however long it is. It used to be capped, so that a draw would
	// come round to re-read the calendars even with nothing to show -- which is
	// the coupling that is gone: reading is the refresher's job now, on its own
	// clock, whether or not anything is drawing.
	it("waits until the window opens, however far off that is", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"distant.ics",
			...timedEvent("distant", "TEST Distant", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:00:00Z"));

		const { nextDrawInMs } = await event.draw(
			await startedContext(fake, [path]),
		);

		// The window opens at 09:55, which is fifty-five minutes off.
		expect(nextDrawInMs).toBe(55 * MS_PER_MINUTE);
	});

	// A day with nothing left in it asks for no draws at all. Something being
	// added to the calendar is not something a draw could have discovered
	// anyway -- the refresher notices, and wakes the program when it does.
	it("asks not to be drawn again when nothing is coming", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"done.ics",
			...timedEvent("done", "TEST Done", "20260101T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:00:00Z"));

		const { nextDrawInMs } = await event.draw(
			await startedContext(fake, [path]),
		);

		expect(fake.draws).toStrictEqual([]);
		expect(nextDrawInMs).toBeUndefined();
	});
});

describe("several calendars", () => {
	it("pools the appointments from all of them", async () => {
		const fake = createFakeBar();
		const work = await calendars.write(
			"work.ics",
			...timedEvent("work", "TEST Work", "20260102T110000Z"),
		);
		const personal = await calendars.write(
			"personal.ics",
			...timedEvent("personal", "TEST Personal", "20260102T100000Z"),
		);

		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await event.draw(await startedContext(fake, [work, personal]));

		// The ten o'clock is the one alerting; the eleven o'clock is not yet.
		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Personal");
	});

	// Carrying on with three calendars out of four means a bar that is
	// confidently silent about a meeting it never saw, and silence is what this
	// program looks like when it is working.
	it("fails the read rather than going quiet about one feed", async () => {
		const fake = createFakeBar();
		const good = await calendars.write(
			"good.ics",
			...timedEvent("good", "TEST Good", "20260102T100000Z"),
		);
		vi.setSystemTime(new Date("2026-01-02T09:57:00Z"));

		await expect(
			event.start?.(contextFor(fake, [good, calendars.missing("missing.ics")])),
		).rejects.toThrow(/could not read/v);
	});
});

describe("when two alerts overlap", () => {
	// Back-to-back meetings, which is what an overlap looks like now that every
	// appointment gets the same five minutes: the two windows are
	// [09:53, 10:00] and [09:55, 10:02], and they share the five minutes
	// between 09:55 and 10:00. At 09:56 the 09:58 is the thing about to be
	// missed.
	//
	// Listed later-first, so that reading them in order would pick the wrong
	// one.
	const OVERLAPPING = [
		...timedEvent("later", "TEST Later", "20260102T100000Z", []),
		...timedEvent("sooner", "TEST Sooner", "20260102T095800Z", []),
	];

	it("gives the screen to whichever starts soonest", async () => {
		const fake = createFakeBar();
		const path = await calendars.write("overlap.ics", ...OVERLAPPING);

		vi.setSystemTime(new Date("2026-01-02T09:56:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Sooner");
	});

	// Which is what stops it sleeping through the next alert while one is
	// already up.
	it("wakes when the next alert opens, not when the current one ends", async () => {
		const fake = createFakeBar();
		const path = await calendars.write("wake.ics", ...OVERLAPPING);

		vi.setSystemTime(new Date("2026-01-02T09:54:00Z"));

		const { nextDrawInMs } = await event.draw(
			await startedContext(fake, [path]),
		);

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Sooner");
		expect(nextDrawInMs).toBe(MS_PER_MINUTE);
	});

	// The noise outlasts the start, so the sooner alert keeps the screen past
	// its own start rather than handing it over the instant it begins.
	it("keeps the sooner alert up while it is still sounding", async () => {
		const fake = createFakeBar();
		const path = await calendars.write("still-sounding.ics", ...OVERLAPPING);

		vi.setSystemTime(new Date("2026-01-02T09:59:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Sooner");
	});

	it("moves to the later alert once the sooner one is done", async () => {
		const fake = createFakeBar();
		const path = await calendars.write("return.ics", ...OVERLAPPING);

		vi.setSystemTime(new Date("2026-01-02T10:01:00Z"));

		await event.draw(await startedContext(fake, [path]));

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Later");
	});
});

// A feed that went wrong once, minutes after a read that worked, has told the
// bar nothing it did not already know about today. Drawing an error over a
// schedule that is still current would take the screen away from the meeting
// the alert was put there for, so a failure waits until what was last read has
// gone stale -- and is logged in the meantime.
describe("when a calendar stops being readable", () => {
	// A twentieth of a second, expressed in the minutes the setting takes, so
	// that a test can watch a read fail without waiting five real minutes.
	const BRIEFLY = { refresh: 0.001 };

	// Long enough for a program on BRIEFLY to have tried again.
	const REFRESHED_MS = 250;

	const READ_AT = "2026-01-02T09:57:00Z";

	// Starts a run against a feed that reads, then takes the feed away and
	// waits for the read that fails on it.
	const nowUnreadable = async (
		fake: FakeBar,
		settings: Record<string, unknown> = {},
	): Promise<ProgramContext> => {
		const path = await calendars.write(
			"flaky.ics",
			...timedEvent("flaky", "TEST Flaky", "20260102T100000Z"),
		);
		const context = await startedContext(fake, [path], {
			...BRIEFLY,
			...settings,
		});

		await calendars.remove("flaky.ics");
		await sleep(REFRESHED_MS);

		return context;
	};

	beforeEach(() => {
		vi.setSystemTime(new Date(READ_AT));
	});

	it("carries on drawing what it last read", async () => {
		const fake = createFakeBar();
		const context = await nowUnreadable(fake);

		await event.draw(context);

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Flaky");
	});

	// Silence is what this program looks like when it is working, so a bar
	// showing nothing because it has not managed a read since yesterday is
	// indistinguishable from a quiet afternoon.
	it("draws the failure once what it last read has gone stale", async () => {
		const fake = createFakeBar();
		const context = await nowUnreadable(fake);

		vi.setSystemTime(new Date("2026-01-03T09:58:00Z"));

		await expect(event.draw(context)).rejects.toThrow(/could not read/v);
	});

	it("takes how long that is from the config file", async () => {
		const fake = createFakeBar();
		const context = await nowUnreadable(fake, { stale: 1 });

		vi.setSystemTime(new Date("2026-01-02T11:00:00Z"));

		await expect(event.draw(context)).rejects.toThrow(/could not read/v);
	});
});
