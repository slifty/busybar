import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import { MS_PER_SECOND } from "../../../constants/time.ts";
import { createFakeBar } from "../../../test/bar.ts";
import {
	createCalendars,
	startedContext,
	timedEvent,
	watchingOne,
} from "../../../test/event.ts";
import { ALERT_COLOR } from "../appointment.ts";
import { INVISIBLE, event } from "../index.ts";
import { REPEAT_MS } from "../sound.ts";
import type { ProgramContext } from "../../../program.ts";
import type { FakeBar } from "../../../test/bar.ts";

// What the alert does once the appointment has begun and nobody has answered:
// the clock is replaced by a word, and the frame starts blinking.

// A ten o'clock appointment, which is what all of these are about.
const START = "20260102T100000Z";

const at = (time: string): Date => new Date(`2026-01-02T${time}Z`);

const calendars = createCalendars();

afterAll(async () => {
	await calendars.forget();
});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });

	// Before anything is started, because starting is what reads the calendars
	// and the reader keeps only what falls near now.
	vi.setSystemTime(at("09:00:00"));
});

afterEach(() => {
	vi.useRealTimers();
});

// A started program watching one appointment with nowhere to be, which is the
// kind that outlasts its start.
const watching = async (fake: FakeBar, name: string): Promise<ProgramContext> =>
	await watchingOne({ fake, calendars, name, start: START });

// A clock reading 00:00 looks like a timer that has finished, which is the
// wrong impression for the one moment the bar is saying you are late.
describe("once the appointment has begun", () => {
	const caption = (fake: FakeBar): string | undefined =>
		(fake.draws.at(-1)?.elements ?? [])
			.filter((element) => element.type === "text")
			.find(({ id }) => id === "event-starts-in")?.text;

	const clockX = (fake: FakeBar): number | undefined =>
		(fake.draws.at(-1)?.elements ?? []).find(
			(element) => element.type === "countdown",
		)?.x;

	it("counts down while there is still time", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "counting");

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		expect(caption(fake)).toBe("in");
	});

	it("says NOW instead of a clock reading zero", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "begun");

		vi.setSystemTime(at("10:00:30"));
		await event.draw(context);

		expect(caption(fake)).toBe("NOW");
	});

	it("says it the instant the appointment starts", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "on-the-dot");

		vi.setSystemTime(at("10:00:00"));
		await event.draw(context);

		expect(caption(fake)).toBe("NOW");
	});

	// An element id outlives the drawing that stopped using it, and a countdown
	// has no blank to send -- so the digits are put where the display is not.
	it("takes the digits off the display rather than leaving them", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "parked");

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		expect(clockX(fake)).toBeGreaterThanOrEqual(0);

		vi.setSystemTime(at("10:00:30"));
		await event.draw(context);

		expect(clockX(fake)).toBeLessThan(0);
	});

	// The swap has to happen at the start rather than whenever the next chime
	// came round, or the bar shows a clock reading 00:00 until it does. Taken
	// five seconds out, where the start is nearer than the next chime and so is
	// what decides the wait.
	it("comes back exactly when the appointment starts", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "on-time");

		vi.setSystemTime(at("09:59:55"));
		const { nextDrawInMs } = await event.draw(context);

		expect(nextDrawInMs).toBe(5 * MS_PER_SECOND);
	});

	// Every alert outlasts its start, so a place says NOW like anything else.
	it("says it for an appointment with somewhere to be", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"located-now.ics",
			...timedEvent("located-now", "TEST Located Now", START, [
				"LOCATION:TEST Room 4",
			]),
		);
		const context = await startedContext(fake, [path]);

		vi.setSystemTime(at("10:00:30"));
		await event.draw(context);

		expect(caption(fake)).toBe("NOW");
	});
});

// The frame blinks rather than the whole alert or the word: everything stays
// legible the whole time, and only the part already doing the interrupting
// moves.
describe("the frame, once the appointment has begun", () => {
	const border = (fake: FakeBar): string | undefined => {
		const element = (fake.draws.at(-1)?.elements ?? []).find(
			({ id }) => id === "event-border",
		);

		return element !== undefined && "border_color" in element
			? element.border_color
			: undefined;
	};

	it("is solid while there is still time", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "solid");

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		expect(border(fake)).toBe(ALERT_COLOR);
	});

	it("goes dark and comes back once the appointment has begun", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "blinking");
		const seen = new Set<string | undefined>();

		// A second of it, half a second at a time.
		for (const offset of [0, 500, 1_000, 1_500]) {
			vi.setSystemTime(new Date(at("10:00:00").getTime() + offset));
			// eslint-disable-next-line no-await-in-loop -- the point is the sequence
			await event.draw(context);
			seen.add(border(fake));
		}

		expect(seen.has(ALERT_COLOR)).toBe(true);
		expect(seen.has(INVISIBLE)).toBe(true);
	});

	// A flag would blink on the draws rather than on the time, and the draws
	// are not evenly spaced.
	it("is in the same phase whichever draw lands on the moment", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "phase");

		vi.setSystemTime(new Date(at("10:00:00").getTime() + 100));
		await event.draw(context);
		const first = border(fake);

		vi.setSystemTime(new Date(at("10:00:00").getTime() + 400));
		await event.draw(context);

		expect(border(fake)).toBe(first);
	});

	it("comes back often enough to blink", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "cadence");

		vi.setSystemTime(at("10:00:30"));
		const { nextDrawInMs } = await event.draw(context);

		expect(nextDrawInMs).toBe(500);
	});

	// The chime keeps its own rhythm now that the screen has a faster one, or
	// blinking would mean a chime twice a second.
	it("does not chime on every blink", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "not-every-blink");

		for (const offset of [0, 500, 1_000, 1_500, 2_000]) {
			vi.setSystemTime(new Date(at("10:00:00").getTime() + offset));
			// eslint-disable-next-line no-await-in-loop -- the point is the sequence
			await event.draw(context);
		}

		expect(fake.plays).toHaveLength(1);
	});

	it("chimes again once the repeat has come round", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "chimes-again");

		vi.setSystemTime(at("10:00:00"));
		await event.draw(context);

		vi.setSystemTime(new Date(at("10:00:00").getTime() + REPEAT_MS));
		await event.draw(context);

		expect(fake.plays).toHaveLength(2);
	});
});
