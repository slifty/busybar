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
	drawnName,
	startedContext,
	stockSoundsPlayed,
	timedEvent,
} from "../../../test/event.ts";
import { event } from "../index.ts";
import { ALERT_SOUND, REPEAT_MS } from "../sound.ts";
import type { ProgramContext } from "../../../program.ts";
import type { FakeBar } from "../../../test/bar.ts";

// A ten o'clock appointment, which is what all of these are about.
const START = "20260102T100000Z";

const at = (time: string): Date => new Date(`2026-01-02T${time}Z`);

const calendars = createCalendars();

afterAll(async () => {
	await calendars.forget();
});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
});

afterEach(() => {
	vi.useRealTimers();
});

// A started program watching one appointment with nowhere to be, which is the
// kind that makes a noise.
const watching = async (
	fake: FakeBar,
	name: string,
	settings: Record<string, unknown> = {},
): Promise<ProgramContext> => {
	const path = await calendars.write(
		`${name}.ics`,
		...timedEvent(name, `TEST ${name}`, START),
	);

	return await startedContext(fake, [path], settings);
};

describe("the sound", () => {
	// The alert is on screen for five minutes and silent for four and a half of
	// them. Looking is enough until it is not.
	it("stays silent while the alert is only being looked at", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "silent");

		vi.setSystemTime(at("09:57:00"));
		await event.draw(context);

		expect(fake.plays).toStrictEqual([]);
	});

	// And wakes exactly when it is due to speak up, rather than finding out on
	// some later schedule of its own.
	it("waits exactly until it is due to make a noise", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "due");

		vi.setSystemTime(at("09:57:00"));
		const { nextDrawInMs } = await event.draw(context);

		// 09:57 to 09:59:30.
		expect(nextDrawInMs).toBe(150 * MS_PER_SECOND);
	});

	it("plays the bar's own calendar chime half a minute out", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "chime");

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		expect(stockSoundsPlayed(fake)).toStrictEqual([ALERT_SOUND]);
		expect(fake.plays[0]?.application_name).toBe(event.name);
	});

	// The chime is under two seconds and the alert is meant to keep asking, so
	// the repeat is the point rather than an artefact of the draw loop.
	it("comes back to chime again while it is sounding", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "repeat");

		vi.setSystemTime(at("09:59:45"));
		const { nextDrawInMs } = await event.draw(context);

		expect(nextDrawInMs).toBe(REPEAT_MS);
	});

	it("keeps chiming after the appointment has started", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "past-start");

		vi.setSystemTime(at("10:01:00"));
		await event.draw(context);

		expect(fake.plays).toHaveLength(1);
		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST past-start");
	});

	// It has to end somehow. An unattended bar acknowledges nothing, and one
	// chiming until somebody comes back to the desk is a worse thing to walk in
	// on than a missed meeting.
	it("falls quiet once the time box has run out", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "timed-out");

		vi.setSystemTime(at("10:01:00"));
		await event.draw(context);

		vi.setSystemTime(at("10:03:00"));
		await event.draw(context);

		expect(fake.plays).toHaveLength(1);
		expect(fake.stops()).toBe(1);
		expect(fake.draws).toHaveLength(1);
	});

	// How long it keeps going is a judgement about the room the bar is in, so
	// it is the file's to make.
	it("takes the time box from the file", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "short-box", {
			sound: { linger: 30 },
		});

		vi.setSystemTime(at("10:01:00"));
		await event.draw(context);

		expect(fake.plays).toStrictEqual([]);
		expect(fake.draws).toStrictEqual([]);
	});

	// Somewhere to be is missed half an hour before it starts, and no chime
	// thirty seconds out was ever going to save it.
	it("never chimes for an appointment with somewhere to be", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"quiet-place.ics",
			...timedEvent("quiet-place", "TEST Quiet Place", START, [
				"LOCATION:TEST Room 4",
			]),
		);
		const context = await startedContext(fake, [path]);

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Quiet Place");
		expect(fake.plays).toStrictEqual([]);
	});
});
