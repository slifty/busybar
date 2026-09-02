import { describe, expect, it } from "vitest";
import { MS_PER_SECOND } from "../../../constants/time.ts";
import { sectionOf } from "../../../test/config.ts";
import {
	alertFor,
	alertsFor,
	isShowing,
	isSounding,
	nextOpensAt,
	showingAt,
} from "../alerts.ts";
import {
	DEFAULT_CHIME_BEFORE_SECONDS,
	DEFAULT_CHIME_EVERY_SECONDS,
	DEFAULT_ENSURE_ALARMS,
	DEFAULT_SCREEN_BEFORE_SECONDS,
	DEFAULT_SCREEN_UNTIL_SECONDS,
	eventSettings,
} from "../settings.ts";
import type { Appointment } from "../appointment.ts";
import type { EventSettings } from "../settings.ts";

const at = (time: string): Date => new Date(`2026-01-02T${time}:00Z`);
const exactly = (time: string): Date => new Date(`2026-01-02T${time}Z`);

// An appointment carrying one alarm at its own start, which is the commonest
// thing a real calendar says and the arrangement most of these are about.
const appointment = (
	name: string,
	start: string,
	alarms: string[] = [start],
): Appointment => ({
	name,
	start: at(start),
	alarms: alarms.map(at),
});

// What the program does when nobody has written a `screen` or `chime` block.
const DEFAULTS: EventSettings = eventSettings(sectionOf());

const settingsOf = (values: Record<string, unknown>): EventSettings =>
	eventSettings(sectionOf(values));

const CALL = appointment("TEST call", "10:00");
const TRIGGER = at("10:00");

describe("alertFor", () => {
	const alert = alertFor(CALL, TRIGGER, DEFAULTS);

	it("goes on screen `screen.before` ahead of the trigger", () => {
		expect(alert.opensAt.toISOString()).toBe(at("09:55").toISOString());
	});

	it("comes off `screen.until` after it", () => {
		expect(alert.endsAt.toISOString()).toBe(at("10:02").toISOString());
	});

	it("starts chiming `chime.before` ahead of it", () => {
		expect(alert.soundsFrom.toISOString()).toBe(
			exactly("09:59:30").toISOString(),
		);
	});

	it("stops chiming `chime.until` after it", () => {
		expect(alert.chimesUntil.toISOString()).toBe(at("10:02").toISOString());
	});

	it("carries the trigger it is about", () => {
		expect(alert.trigger.toISOString()).toBe(TRIGGER.toISOString());
	});

	it("takes each of them from the file when the file says so", () => {
		const settings = settingsOf({
			screen: { before: 60, until: 30 },
			chime: { before: 10, until: 20 },
		});
		const configured = alertFor(CALL, TRIGGER, settings);

		expect(configured.opensAt.toISOString()).toBe(at("09:59").toISOString());
		expect(configured.endsAt.toISOString()).toBe(
			exactly("10:00:30").toISOString(),
		);
		expect(configured.soundsFrom.toISOString()).toBe(
			exactly("09:59:50").toISOString(),
		);
		expect(configured.chimesUntil.toISOString()).toBe(
			exactly("10:00:20").toISOString(),
		);
	});

	// A bar making a noise about something it is not naming is alarming and
	// unhelpful in the same breath, so the screen covers the chime at both
	// ends however the two are set.
	describe("when the chime is asked to outlast the screen", () => {
		it("is on screen by the time it makes a noise", () => {
			const settings = settingsOf({
				screen: { before: 0 },
				chime: { before: 60 },
			});
			const wide = alertFor(CALL, TRIGGER, settings);

			expect(wide.opensAt.toISOString()).toBe(at("09:59").toISOString());
			expect(wide.opensAt.getTime()).toBeLessThanOrEqual(
				wide.soundsFrom.getTime(),
			);
		});

		it("is still on screen when it stops", () => {
			const settings = settingsOf({
				screen: { until: 0 },
				chime: { until: 60 },
			});
			const wide = alertFor(CALL, TRIGGER, settings);

			expect(wide.endsAt.toISOString()).toBe(at("10:01").toISOString());
			expect(wide.endsAt.getTime()).toBeGreaterThanOrEqual(
				wide.chimesUntil.getTime(),
			);
		});
	});

	// The other way round is ordinary rather than a conflict: most of an
	// alert's life is meant to be a yellow frame you can glance at.
	it("stays on screen after it has fallen quiet", () => {
		const settings = settingsOf({ chime: { until: 0 } });
		const brief = alertFor(CALL, TRIGGER, settings);

		expect(brief.chimesUntil.toISOString()).toBe(at("10:00").toISOString());
		expect(brief.endsAt.toISOString()).toBe(at("10:02").toISOString());
	});
});

describe("alertsFor", () => {
	// An entry's alarms are separate interruptions -- a nudge an hour out and
	// the one that catches you on the way -- so each gets its own alert.
	it("gives every alarm its own alert", () => {
		const twice = appointment("TEST twice", "10:00", ["09:00", "10:00"]);

		expect(
			alertsFor([twice], DEFAULTS).map(({ trigger }) => trigger.toISOString()),
		).toStrictEqual([at("09:00").toISOString(), at("10:00").toISOString()]);
	});

	// Most of a real calendar names no instant at all, and a bar silent about
	// nine meetings in ten would look broken -- so an entry that asked for
	// nothing is given the one thing the bar knows about it.
	describe("an appointment with no alarms of its own", () => {
		const silent = appointment("TEST silent", "10:00", []);

		it("is triggered at its own start", () => {
			expect(
				alertsFor([silent], DEFAULTS).map(({ trigger }) =>
					trigger.toISOString(),
				),
			).toStrictEqual([at("10:00").toISOString()]);
		});

		// Which puts it on screen exactly where the bar has always put it.
		it("goes on screen `screen.before` ahead of that start", () => {
			const [alert] = alertsFor([silent], DEFAULTS);

			expect(alert?.opensAt.toISOString()).toBe(at("09:55").toISOString());
		});

		it("is left alone when the file turns it off", () => {
			const settings = settingsOf({ ensure_alarms: false });

			expect(alertsFor([silent], settings)).toStrictEqual([]);
		});

		// Only entries that asked for nothing are given one. One that asked for
		// something has already been answered.
		it("does not gain one when the calendar named its own", () => {
			const asked = appointment("TEST asked", "10:00", ["09:00"]);

			expect(
				alertsFor([asked], DEFAULTS).map(({ trigger }) =>
					trigger.toISOString(),
				),
			).toStrictEqual([at("09:00").toISOString()]);
		});
	});

	it("keeps the appointment on each of its alerts", () => {
		const twice = appointment("TEST twice", "10:00", ["09:00", "10:00"]);

		expect(
			alertsFor([twice], DEFAULTS).map(({ appointment: { name } }) => name),
		).toStrictEqual(["TEST twice", "TEST twice"]);
	});
});

describe("isShowing", () => {
	const alert = alertFor(CALL, TRIGGER, DEFAULTS);

	it("is not showing before the window opens", () => {
		expect(isShowing(alert, at("09:54"))).toBe(false);
	});

	it("is showing the instant the window opens", () => {
		expect(isShowing(alert, at("09:55"))).toBe(true);
	});

	it("is showing inside the window", () => {
		expect(isShowing(alert, at("09:58"))).toBe(true);
	});

	it("is still showing while it is still making a noise", () => {
		expect(isShowing(alert, at("10:01"))).toBe(true);
	});

	it("stops once the window has run out", () => {
		expect(isShowing(alert, at("10:03"))).toBe(false);
	});
});

describe("isSounding", () => {
	const alert = alertFor(CALL, TRIGGER, DEFAULTS);

	it("is silent while the alert is only being looked at", () => {
		expect(isSounding(alert, at("09:57"))).toBe(false);
	});

	it("starts at the chime's own lead, not the screen's", () => {
		expect(isSounding(alert, exactly("09:59:30"))).toBe(true);
	});

	it("carries on past the trigger", () => {
		expect(isSounding(alert, at("10:01"))).toBe(true);
	});

	it("stops when the chime's own window runs out", () => {
		const settings = settingsOf({ chime: { until: 30 } });
		const brief = alertFor(CALL, TRIGGER, settings);

		expect(isSounding(brief, exactly("10:00:45"))).toBe(false);
		expect(isShowing(brief, exactly("10:00:45"))).toBe(true);
	});
});

describe("showingAt", () => {
	// Back to back meetings: windows of [09:53, 10:00] and [09:55, 10:02],
	// sharing the five minutes between 09:55 and 10:00.
	const SOONER = appointment("TEST sooner", "09:58");
	const LATER = appointment("TEST later", "10:00");

	// Read in the order that would be wrong to keep.
	const alerts = alertsFor([LATER, SOONER], DEFAULTS);

	it("finds nothing when nothing is close enough", () => {
		expect(showingAt(alerts, at("09:00"))).toBeUndefined();
	});

	it("finds the one appointment whose window is open", () => {
		expect(showingAt(alerts, at("09:54"))?.appointment.name).toBe(SOONER.name);
	});

	describe("when two alerts overlap", () => {
		it("gives the screen to whichever appointment starts soonest", () => {
			expect(showingAt(alerts, at("09:56"))?.appointment.name).toBe(
				SOONER.name,
			);
		});

		it("moves to the later alert once the sooner one is done", () => {
			expect(showingAt(alerts, at("10:01"))?.appointment.name).toBe(LATER.name);
		});

		// Two alerts on one appointment say the same thing, so which holds the
		// screen shows only in when the device is told to take it down --
		// picking the shorter would take the alert off and put it back up.
		it("prefers the longer of two alerts on one appointment", () => {
			const twice = appointment("TEST twice", "10:00", ["09:56", "10:00"]);
			const showing = showingAt(alertsFor([twice], DEFAULTS), at("09:56"));

			expect(showing?.endsAt.toISOString()).toBe(at("10:02").toISOString());
		});

		// `sort` is stable, so leaving equal starts untouched preserves the
		// order they were read in.
		it("settles an exact tie by the order they were read", () => {
			const first = appointment("TEST first", "10:00");
			const second = appointment("TEST second", "10:00");

			expect(
				showingAt(alertsFor([first, second], DEFAULTS), at("09:56"))
					?.appointment.name,
			).toBe(first.name);
		});
	});

	it("ignores an appointment whose alert has run out", () => {
		expect(showingAt(alertsFor([CALL], DEFAULTS), at("10:05"))).toBeUndefined();
	});
});

describe("nextOpensAt", () => {
	const SOONER = appointment("TEST sooner", "09:58");
	const LATER = appointment("TEST later", "10:00");
	const alerts = alertsFor([SOONER, LATER], DEFAULTS);

	it("finds nothing when every window has already opened", () => {
		expect(nextOpensAt(alerts, at("09:56"))).toBeUndefined();
	});

	it("finds the soonest window still ahead", () => {
		expect(nextOpensAt(alerts, at("09:00"))).toStrictEqual(at("09:53"));
	});

	// This is what stops the program sleeping through the next alert while one
	// is already on screen.
	it("finds a window that opens while another alert is up", () => {
		expect(nextOpensAt(alerts, at("09:54"))).toStrictEqual(at("09:55"));
	});

	// An entry's own second alarm is one of those windows.
	it("finds another alarm on the appointment already showing", () => {
		const twice = appointment("TEST twice", "10:00", ["09:30", "10:00"]);

		expect(
			nextOpensAt(alertsFor([twice], DEFAULTS), at("09:26")),
		).toStrictEqual(at("09:55"));
	});

	it("never points backwards", () => {
		const now = at("09:54");

		expect(nextOpensAt(alerts, now)?.getTime()).toBeGreaterThan(now.getTime());
	});
});

describe("chime.every", () => {
	// A chime repeating every zero seconds plays on every draw and asks for the
	// next draw immediately, which is a bar making a noise and talking to
	// itself as fast as it can until somebody unplugs it. It is refused where
	// it is written rather than clamped, because a file asking for it has said
	// something it cannot have meant.
	it("is refused when the file asks for no gap at all", () => {
		expect(() => settingsOf({ chime: { every: 0 } })).toThrow(
			"chime.every must be more than zero",
		);
	});

	it("is taken from the file when the file says one", () => {
		expect(settingsOf({ chime: { every: 4 } }).chime.everyMs).toBe(
			4 * MS_PER_SECOND,
		);
	});
});

describe("the defaults", () => {
	// Every one of these is in seconds, where `refresh` and `stale` are in
	// minutes and hours -- which is obvious in the file and easy to get wrong
	// in the code.
	it("reads every window as seconds", () => {
		expect(DEFAULTS.screen.beforeMs).toBe(
			DEFAULT_SCREEN_BEFORE_SECONDS * MS_PER_SECOND,
		);
		expect(DEFAULTS.screen.untilMs).toBe(
			DEFAULT_SCREEN_UNTIL_SECONDS * MS_PER_SECOND,
		);
		expect(DEFAULTS.chime.beforeMs).toBe(
			DEFAULT_CHIME_BEFORE_SECONDS * MS_PER_SECOND,
		);
		expect(DEFAULTS.chime.everyMs).toBe(
			DEFAULT_CHIME_EVERY_SECONDS * MS_PER_SECOND,
		);
	});

	// The five minutes the bar has always given an appointment, now expressed
	// as how far it runs ahead of whatever instant the calendar named.
	it("puts the screen five minutes ahead of a trigger", () => {
		expect(DEFAULT_SCREEN_BEFORE_SECONDS).toBe(300);
	});

	// Nine entries in ten carry no alarm, and a bar quiet about those would be
	// indistinguishable from a broken one.
	it("supplies a trigger for an appointment that named none", () => {
		expect(DEFAULTS.ensureAlarms).toBe(DEFAULT_ENSURE_ALARMS);
		expect(DEFAULT_ENSURE_ALARMS).toBe(true);
	});

	// Most of an alert is meant to be silent: a yellow frame you can glance at
	// and go back to what you were doing.
	it("keeps most of an alert quiet", () => {
		expect(DEFAULT_CHIME_BEFORE_SECONDS).toBeLessThan(
			DEFAULT_SCREEN_BEFORE_SECONDS,
		);
	});
});
