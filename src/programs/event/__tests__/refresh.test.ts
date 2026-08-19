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
import { createFakeBar } from "../../../test/bar.ts";
import {
	contextFor,
	createCalendars,
	createSignals,
	timedEvent,
} from "../../../test/event.ts";
import { createRefresher, fingerprint } from "../refresh.ts";
import { eventSettings } from "../settings.ts";
import type { Appointment } from "../appointment.ts";

const calendars = createCalendars();

afterAll(async () => {
	await calendars.forget();
});

beforeEach(() => {
	vi.useFakeTimers({ toFake: ["Date"] });
	vi.setSystemTime(new Date("2026-01-02T09:00:00Z"));
});

afterEach(() => {
	vi.useRealTimers();
});

// A twentieth of a second, expressed in the minutes the setting takes, so that
// a test can watch a second read happen without waiting five real minutes.
const BRIEFLY = { refresh: 0.001 };

// Long enough for a refresher on BRIEFLY to have read again.
const REFRESHED_MS = 250;

const settle = async (): Promise<void> => {
	await sleep(REFRESHED_MS);
};

const appointment = (name: string, start: string): Appointment => ({
	name,
	start: new Date(start),
	kind: "plain",
});

describe("fingerprint", () => {
	// The bar only ever speaks about a name, a start and a kind, so a read that
	// agrees about all three is the same day however it arrived.
	it("is the same for the same appointments in a different order", () => {
		const one = appointment("TEST one", "2026-01-02T10:00:00Z");
		const two = appointment("TEST two", "2026-01-02T11:00:00Z");

		expect(fingerprint([one, two])).toBe(fingerprint([two, one]));
	});

	it("changes when an appointment moves", () => {
		expect(fingerprint([appointment("TEST", "2026-01-02T10:00:00Z")])).not.toBe(
			fingerprint([appointment("TEST", "2026-01-02T10:30:00Z")]),
		);
	});
});

describe("createRefresher", () => {
	it("has read nothing before it begins", () => {
		expect(createRefresher().appointments()).toStrictEqual([]);
	});

	it("reads once, up front, so a bad feed fails the program", async () => {
		const refresher = createRefresher();
		const fake = createFakeBar();
		const missing = calendars.missing("nope.ics");
		const context = contextFor(fake, [missing]);

		await expect(
			refresher.begin(eventSettings(context.config), context),
		).rejects.toThrow(/could not read/v);

		refresher.stop();
	});

	it("has the appointments once it has begun", async () => {
		const refresher = createRefresher();
		const fake = createFakeBar();
		const path = await calendars.write(
			"read.ics",
			...timedEvent("read", "TEST Read", "20260102T100000Z"),
		);
		const context = contextFor(fake, [path]);

		await refresher.begin(eventSettings(context.config), context);

		expect(refresher.appointments().map(({ name }) => name)).toStrictEqual([
			"TEST Read",
		]);

		refresher.stop();
	});

	describe("on the interval", () => {
		// The point of the whole separation: a meeting added while nothing is
		// drawing still reaches the program.
		it("picks up an appointment added since it started", async () => {
			const refresher = createRefresher();
			const fake = createFakeBar();
			const path = await calendars.write("added.ics");
			const context = contextFor(fake, [path], BRIEFLY);

			await refresher.begin(eventSettings(context.config), context);

			expect(refresher.appointments()).toStrictEqual([]);

			await calendars.write(
				"added.ics",
				...timedEvent("added", "TEST Added", "20260102T100000Z"),
			);
			await settle();

			expect(refresher.appointments().map(({ name }) => name)).toStrictEqual([
				"TEST Added",
			]);

			refresher.stop();
		});

		// Nothing is on screen and nothing has to change, so waking the program
		// would have it redrawing on the refresh interval for as long as it
		// runs -- which is the coupling this exists to remove.
		it("does not wake the program for a read that changed nothing", async () => {
			const refresher = createRefresher();
			const fake = createFakeBar();
			const signals = createSignals();
			const path = await calendars.write(
				"unchanged.ics",
				...timedEvent("unchanged", "TEST Unchanged", "20260102T100000Z"),
			);
			const context = contextFor(fake, [path], BRIEFLY, signals);

			await refresher.begin(eventSettings(context.config), context);
			await settle();

			expect(signals.redraws()).toBe(0);

			refresher.stop();
		});

		it("wakes the program when the day changed", async () => {
			const refresher = createRefresher();
			const fake = createFakeBar();
			const signals = createSignals();
			const path = await calendars.write("changed.ics");
			const context = contextFor(fake, [path], BRIEFLY, signals);

			await refresher.begin(eventSettings(context.config), context);
			await calendars.write(
				"changed.ics",
				...timedEvent("changed", "TEST Changed", "20260102T100000Z"),
			);
			await settle();

			expect(signals.redraws()).toBeGreaterThan(0);

			refresher.stop();
		});

		// A feed that cannot be read has to reach the display. Silence is what
		// this program looks like when it is working, so a bar showing nothing
		// because it has not managed a read since breakfast is the exact
		// failure worth making loud.
		it("keeps a failure for the draw to put on the bar", async () => {
			const refresher = createRefresher();
			const fake = createFakeBar();
			const signals = createSignals();
			const path = await calendars.write(
				"vanishing.ics",
				...timedEvent("vanishing", "TEST Vanishing", "20260102T100000Z"),
			);
			const context = contextFor(fake, [path], BRIEFLY, signals);

			await refresher.begin(eventSettings(context.config), context);

			expect(refresher.failure()).toBeUndefined();

			// The feed stops being readable partway through the run.
			await calendars.remove("vanishing.ics");
			await settle();

			expect(refresher.failure()?.message).toMatch(/could not read/v);
			expect(signals.redraws()).toBeGreaterThan(0);

			refresher.stop();
		});

		// Stopping has to stop it, or a finished run keeps fetching calendars.
		it("stops reading once it is stopped", async () => {
			const refresher = createRefresher();
			const fake = createFakeBar();
			const signals = createSignals();
			const path = await calendars.write("stopped.ics");
			const context = contextFor(fake, [path], BRIEFLY, signals);

			await refresher.begin(eventSettings(context.config), context);
			refresher.stop();

			await calendars.write(
				"stopped.ics",
				...timedEvent("stopped", "TEST Stopped", "20260102T100000Z"),
			);
			await settle();

			expect(refresher.appointments()).toStrictEqual([]);
			expect(signals.redraws()).toBe(0);
		});
	});
});
