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
import { MS_PER_SECOND } from "../../../constants/time.ts";
import { createFakeBar } from "../../../test/bar.ts";
import {
	contextFor,
	createCalendars,
	createSignals,
	drawnName,
	startedContext,
	stockSoundsPlayed,
	timedEvent,
} from "../../../test/event.ts";
import { event } from "../index.ts";
import { DEFAULT_CHIME_EVERY_SECONDS } from "../settings.ts";
import { ALERT_SOUND } from "../sound.ts";
import type { ProgramContext } from "../../../program.ts";
import type { FakeBar } from "../../../test/bar.ts";

// The bar has three buttons and this program has one thing to say, so which one
// is pressed is deliberately not part of any of this.
const ANY_BUTTON = "ok";

// Long enough for a refresher on a very short interval to have read again.
const REFRESHED_MS = 250;

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
	// and the reader keeps only what falls near now. Each test moves the clock
	// on to the moment it is actually about.
	vi.setSystemTime(at("09:00:00"));
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

		expect(nextDrawInMs).toBe(DEFAULT_CHIME_EVERY_SECONDS * MS_PER_SECOND);
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
			screen: { until: 30 },
			chime: { until: 30 },
		});

		vi.setSystemTime(at("10:01:00"));
		await event.draw(context);

		expect(fake.plays).toStrictEqual([]);
		expect(fake.draws).toStrictEqual([]);
	});

	// The chime is for every appointment, including one the calendar gave a
	// place: silencing an alert is not a thing to do on a guess about where it
	// is.
	it("chimes for an appointment with somewhere to be", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"place.ics",
			...timedEvent("place", "TEST Place", START, ["LOCATION:TEST Room 4"]),
		);
		const context = await startedContext(fake, [path]);

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		expect(drawnName(fake.draws[0]?.elements ?? [])).toBe("TEST Place");
		expect(fake.plays).not.toStrictEqual([]);
	});
});

describe("an alert that stops being one", () => {
	// The elements carry the alert's end as their expiry and the draw is
	// scheduled for that instant, so the device has almost always taken them
	// down already and this clear is a formality.
	it("comes down when it has run its course", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "run-out");

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		vi.setSystemTime(at("10:03:00"));
		await event.draw(context);

		expect(fake.clears).toContainEqual({ application_name: event.name });
	});

	// What the clear is actually for. The expiry is still minutes off, the
	// device knows nothing about the calendar, and nothing else would take a
	// yellow frame off the screen for a meeting that is not happening.
	//
	// Driven through the refresher on a very short interval, because noticing
	// the calendar changed is its job now rather than the draw's -- which is
	// the whole point of the separation, and worth one test that proves the two
	// halves meet.
	it("comes down when the calendar stops mentioning the meeting", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"cancelled.ics",
			...timedEvent("cancelled", "TEST Cancelled", START),
		);
		// A twentieth of a second, expressed in the minutes the setting takes.
		const context = await startedContext(fake, [path], { refresh: 0.001 });

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		expect(fake.clears).toStrictEqual([]);

		// The meeting is called off while its alert is on screen.
		await calendars.write("cancelled.ics");
		await sleep(REFRESHED_MS);

		await event.draw(context);

		expect(fake.clears).toContainEqual({ application_name: event.name });
		expect(fake.stops()).toBe(1);
	});

	// And having come down once, it does not go on being cleared for as long as
	// the program has nothing to say.
	it("is not cleared again on every draw afterwards", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "quiet-after");

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		vi.setSystemTime(at("10:03:00"));
		await event.draw(context);
		await event.draw(context);

		expect(fake.clears).toHaveLength(1);
	});
});

// The device destroys a lower-priority application's elements rather than
// hiding them behind ours, and never puts them back -- so a program that
// interrupts the others has to say when it has finished, or the screen stays
// blank until whatever it interrupted happens to draw again on its own
// schedule, which can be hours.
describe("letting the other programs have the screen back", () => {
	const watched = async (
		fake: FakeBar,
		name: string,
	): Promise<{
		readonly context: ProgramContext;
		readonly releases: () => number;
	}> => {
		const path = await calendars.write(
			`${name}.ics`,
			...timedEvent(name, `TEST ${name}`, START),
		);
		const signals = createSignals();
		const context = contextFor(fake, [path], {}, signals);

		await event.start?.(context);

		return { context, releases: signals.releases };
	};

	it("says so when an alert is acknowledged", async () => {
		const fake = createFakeBar();
		const { context, releases } = await watched(fake, "released-by-press");

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		expect(releases()).toBe(0);

		await event.onButton?.(ANY_BUTTON, context);

		expect(releases()).toBe(1);
	});

	// The other way an alert ends. Nobody pressed anything, so nothing else
	// would mark the moment.
	it("says so when an alert runs out of time", async () => {
		const fake = createFakeBar();
		const { context, releases } = await watched(fake, "released-by-timeout");

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		vi.setSystemTime(at("10:03:00"));
		await event.draw(context);

		expect(releases()).toBe(1);
	});

	// Most of the day this program draws nothing at all, and saying "the screen
	// is yours" on every one of those draws would have every other program
	// redrawing every fifteen minutes for no reason.
	it("says nothing when it never had the screen", async () => {
		const fake = createFakeBar();
		const { context, releases } = await watched(fake, "never-had-it");

		vi.setSystemTime(at("09:00:00"));
		await event.draw(context);
		await event.draw(context);

		expect(releases()).toBe(0);
	});

	it("says so once rather than on every draw afterwards", async () => {
		const fake = createFakeBar();
		const { context, releases } = await watched(fake, "released-once");

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		vi.setSystemTime(at("10:03:00"));
		await event.draw(context);
		await event.draw(context);

		expect(releases()).toBe(1);
	});
});

describe("acknowledging with the button", () => {
	// A program with a chiming alert on screen, which is what a press answers.
	const sounding = async (
		fake: FakeBar,
		name: string,
	): Promise<ProgramContext> => {
		const context = await watching(fake, name);

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);

		return context;
	};

	it("stops the sound", async () => {
		const fake = createFakeBar();
		const context = await sounding(fake, "stops");

		await event.onButton?.(ANY_BUTTON, context);

		expect(fake.stops()).toBe(1);
	});

	// The elements were drawn to expire when the alert would have ended, so
	// they outlast being answered unless they are taken down. This is the one
	// place the program clears the screen itself.
	// Nothing playing is the ordinary case, not a failure: the chimes are ten
	// seconds apart and under two seconds long, so a press lands between two of
	// them far more often than during one. Reporting it would put a line in the
	// log for every acknowledgement that worked exactly as intended, which is
	// what running this on a real bar showed.
	it("says nothing when the chime had already finished", async () => {
		const fake = createFakeBar();
		const context = await sounding(fake, "already-finished");
		const logs: string[] = [];

		fake.stopRejectsWith = Object.assign(new Error("No audio is playing"), {
			status: 410,
		});

		await event.onButton?.(ANY_BUTTON, {
			...context,
			log: (message) => {
				logs.push(message);
			},
		});

		expect(logs.join(" ")).not.toMatch(/sound/v);
	});

	// A refusal that is not "nothing is playing" is worth a line, and still not
	// worth taking the program down for.
	it("says so when stopping the chime really failed", async () => {
		const fake = createFakeBar();
		const context = await sounding(fake, "stop-failed");
		const logs: string[] = [];

		fake.stopRejectsWith = new Error("TEST the bar is unreachable");

		await event.onButton?.(ANY_BUTTON, {
			...context,
			log: (message) => {
				logs.push(message);
			},
		});

		expect(logs.join(" ")).toMatch(/could not stop the alert sound/v);
	});

	it("takes the alert off the screen", async () => {
		const fake = createFakeBar();
		const context = await sounding(fake, "clears");

		await event.onButton?.(ANY_BUTTON, context);

		expect(fake.clears).toContainEqual({ application_name: event.name });
	});

	it("asks to be drawn again, and draws nothing", async () => {
		const fake = createFakeBar();
		const context = await sounding(fake, "redraws");

		const result = await event.onButton?.(ANY_BUTTON, context);

		expect(result?.redraw).toBe(true);

		const drawnBefore = [...fake.draws];
		const playedBefore = [...fake.plays];

		await event.draw(context);

		expect(fake.draws).toStrictEqual(drawnBefore);
		expect(fake.plays).toStrictEqual(playedBefore);
	});

	// The whole point of remembering: without it the next draw finds the same
	// appointment in the same window and puts the same alert straight back up.
	it("does not let the alert come back a minute later", async () => {
		const fake = createFakeBar();
		const context = await sounding(fake, "stays-gone");

		await event.onButton?.(ANY_BUTTON, context);

		vi.setSystemTime(at("10:01:00"));

		const drawnBefore = [...fake.draws];

		await event.draw(context);

		expect(fake.draws).toStrictEqual(drawnBefore);
	});

	// Every program that takes presses hears every press, so most of what
	// arrives is somebody using the bar for something else.
	it("does nothing when there is no alert on screen", async () => {
		const fake = createFakeBar();
		const context = await watching(fake, "nothing-up");

		vi.setSystemTime(at("09:00:00"));
		await event.draw(context);

		const result = await event.onButton?.(ANY_BUTTON, context);

		expect(result?.redraw ?? false).toBe(false);
		expect(fake.stops()).toBe(0);
		expect(fake.clears).toStrictEqual([]);
	});

	// Acknowledging is about one alert, not about the day. The next appointment
	// gets its own interruption.
	it("leaves the next appointment's alert alone", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"two.ics",
			...timedEvent("first", "TEST First", START),
			...timedEvent("second", "TEST Second", "20260102T101000Z"),
		);
		const context = await startedContext(fake, [path]);

		vi.setSystemTime(at("09:59:45"));
		await event.draw(context);
		await event.onButton?.(ANY_BUTTON, context);

		vi.setSystemTime(at("10:06:00"));
		await event.draw(context);

		expect(drawnName(fake.draws.at(-1)?.elements ?? [])).toBe("TEST Second");
	});

	// An alert that is only being looked at is the same interruption as one
	// making a noise, and a bar that only takes an answer while it is chiming
	// is a bar with a rule nobody was told. Four and a half of the five
	// minutes are silent, so this is most of the alert's life.
	it("dismisses an alert that is not chiming yet", async () => {
		const fake = createFakeBar();
		const path = await calendars.write(
			"quiet-ack.ics",
			...timedEvent("quiet-ack", "TEST Quiet Ack", START, []),
		);
		const context = await startedContext(fake, [path]);

		vi.setSystemTime(at("09:56:00"));
		await event.draw(context);

		const result = await event.onButton?.(ANY_BUTTON, context);

		expect(result?.redraw).toBe(true);
		expect(fake.clears).toContainEqual({ application_name: event.name });

		const drawnBefore = [...fake.draws];

		await event.draw(context);

		expect(fake.draws).toStrictEqual(drawnBefore);
	});
});
