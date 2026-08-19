import { describe, expect, it } from "vitest";
import { MS_PER_MINUTE, MS_PER_SECOND } from "../../../constants/time.ts";
import { sectionOf } from "../../../test/config.ts";
import {
	alertFor,
	alertsFor,
	isShowing,
	isSounding,
	nextOpensAt,
	showingAt,
} from "../alerts.ts";
import { LEAD_MINUTES } from "../appointment.ts";
import { eventSettings } from "../settings.ts";
import type { Appointment, Kind } from "../appointment.ts";
import type { EventSettings } from "../settings.ts";

const at = (time: string): Date => new Date(`2026-01-02T${time}:00Z`);

const appointment = (name: string, start: string, kind: Kind): Appointment => ({
	name,
	start: at(start),
	kind,
});

// What the program does when nobody has written a `leads` or `sound` block,
// which is the arrangement every one of these is about unless it says
// otherwise.
const DEFAULTS: EventSettings = eventSettings(sectionOf());

const settingsOf = (values: Record<string, unknown>): EventSettings =>
	eventSettings(sectionOf(values));

// Named for the shape being tested rather than for anything anybody does.
const CALL = appointment("TEST call", "10:00", "url");
const ACROSS_TOWN = appointment("TEST across town", "10:00", "located");

describe("alertFor", () => {
	it.each([
		["url", "url" as const, "09:55"],
		["located", "located" as const, "09:30"],
		["plain", "plain" as const, "09:55"],
	])("opens the %s window at its lead", (_label, kind, expected) => {
		const alert = alertFor(appointment("TEST", "10:00", kind), DEFAULTS);

		expect(alert.opensAt.toISOString()).toBe(at(expected).toISOString());
	});

	// The distinction the whole program exists for: somewhere to be gets the
	// warning that covers getting there.
	it("gives a place more warning than a link", () => {
		expect(alertFor(ACROSS_TOWN, DEFAULTS).opensAt.getTime()).toBeLessThan(
			alertFor(CALL, DEFAULTS).opensAt.getTime(),
		);
	});

	// The numbers are an argument about how far away somebody's meetings are,
	// and the file is where an argument like that gets settled.
	it("takes the lead from the file when the file says one", () => {
		const settings = settingsOf({ leads: { located: 1 } });

		expect(alertFor(ACROSS_TOWN, settings).opensAt.toISOString()).toBe(
			at("09:59").toISOString(),
		);
	});

	describe("when the appointment has somewhere to be", () => {
		const alert = alertFor(ACROSS_TOWN, DEFAULTS);

		// No chime thirty seconds out was going to get anybody across town, and
		// the alert's job is over once it is time.
		it("never makes a noise", () => {
			expect(alert.soundsFrom).toBeUndefined();
		});

		it("ends the instant the appointment starts", () => {
			expect(alert.endsAt.toISOString()).toBe(at("10:00").toISOString());
		});
	});

	describe("when the appointment has nowhere to be", () => {
		const alert = alertFor(CALL, DEFAULTS);

		it("starts making a noise half a minute out", () => {
			expect(alert.soundsFrom?.toISOString()).toBe(
				new Date("2026-01-02T09:59:30Z").toISOString(),
			);
		});

		// It is meant to continue until it is acknowledged, and an unattended
		// bar acknowledges nothing -- so something has to end it.
		it("keeps going past the start rather than stopping there", () => {
			expect(alert.endsAt.getTime()).toBeGreaterThan(CALL.start.getTime());
		});

		it("stops when the file says to stop", () => {
			const settings = settingsOf({ sound: { linger: 30 } });

			expect(alertFor(CALL, settings).endsAt.toISOString()).toBe(
				new Date("2026-01-02T10:00:30Z").toISOString(),
			);
		});
	});

	// A file is free to set a warning shorter than the sound's own lead, and a
	// bar chiming about an appointment it is not naming is alarming and
	// useless in the same breath.
	it("is on screen by the time it makes a noise, whatever the leads say", () => {
		const settings = settingsOf({
			leads: { url: 0 },
			sound: { lead: 60 },
		});
		const alert = alertFor(CALL, settings);

		expect(alert.opensAt.getTime()).toBeLessThanOrEqual(
			alert.soundsFrom?.getTime() ?? Infinity,
		);
	});
});

describe("isShowing", () => {
	const alert = alertFor(CALL, DEFAULTS);

	it("is not showing before the window opens", () => {
		expect(isShowing(alert, at("09:54"))).toBe(false);
	});

	it("is showing the instant the window opens", () => {
		expect(isShowing(alert, at("09:55"))).toBe(true);
	});

	it("is showing inside the window", () => {
		expect(isShowing(alert, at("09:58"))).toBe(true);
	});

	// The noise outlasts the start, and the screen must not go quiet while the
	// bar is still shouting.
	it("is still showing while it is still making a noise", () => {
		expect(isShowing(alert, at("10:01"))).toBe(true);
	});

	it("stops once the noise has timed out", () => {
		expect(isShowing(alert, at("10:03"))).toBe(false);
	});

	// An alert with somewhere to be has nothing to say once it is time.
	it("stops a silent alert the instant the appointment starts", () => {
		expect(isShowing(alertFor(ACROSS_TOWN, DEFAULTS), at("10:00"))).toBe(false);
	});
});

describe("isSounding", () => {
	const alert = alertFor(CALL, DEFAULTS);

	it("is silent while the alert is only being looked at", () => {
		expect(isSounding(alert, at("09:57"))).toBe(false);
	});

	it("starts at the sound's own lead, not the alert's", () => {
		expect(isSounding(alert, new Date("2026-01-02T09:59:30Z"))).toBe(true);
	});

	it("carries on past the start", () => {
		expect(isSounding(alert, at("10:01"))).toBe(true);
	});

	it("stops when the alert does", () => {
		expect(isSounding(alert, at("10:03"))).toBe(false);
	});

	it("never sounds for an appointment with somewhere to be", () => {
		const located = alertFor(ACROSS_TOWN, DEFAULTS);

		expect(isSounding(located, at("09:59"))).toBe(false);
		expect(isSounding(located, at("10:00"))).toBe(false);
	});
});

describe("showingAt", () => {
	const alerts = alertsFor([CALL, ACROSS_TOWN], DEFAULTS);

	it("finds nothing when nothing is close enough", () => {
		expect(showingAt(alerts, at("09:00"))).toBeUndefined();
	});

	it("finds the one appointment whose window is open", () => {
		expect(showingAt(alerts, at("09:40"))?.appointment.name).toBe(
			ACROSS_TOWN.name,
		);
	});

	// Overlapping alerts are ordinary rather than a conflict: a distant
	// appointment with a long lead runs into a near one with a short lead, and
	// both are real. What has to be decided is which owns the display.
	describe("when two alerts overlap", () => {
		const LATER_BUT_SHOWING = appointment("TEST later", "10:00", "located");
		const SOONER = appointment("TEST sooner", "09:45", "url");
		const overlapping = alertsFor([LATER_BUT_SHOWING, SOONER], DEFAULTS);

		it("gives the screen to whichever starts soonest", () => {
			expect(showingAt(overlapping, at("09:41"))?.appointment.name).toBe(
				SOONER.name,
			);
		});

		// Sorting by start rather than by which spoke first is what makes the
		// more urgent win, whichever had the screen.
		it("takes the screen from an alert that was already up", () => {
			expect(showingAt(overlapping, at("09:39"))?.appointment.name).toBe(
				LATER_BUT_SHOWING.name,
			);
			expect(showingAt(overlapping, at("09:41"))?.appointment.name).toBe(
				SOONER.name,
			);
		});

		// And hands it back once the sooner one has stopped -- which, for one
		// that makes a noise, is after the noise has timed out rather than at
		// its start.
		it("returns to the longer alert once the sooner one is done", () => {
			expect(showingAt(overlapping, at("09:48"))?.appointment.name).toBe(
				LATER_BUT_SHOWING.name,
			);
		});

		// `sort` is stable, so leaving equal starts untouched preserves the
		// order they were read in.
		it("settles an exact tie by the order they were read", () => {
			const first = appointment("TEST first", "10:00", "url");
			const second = appointment("TEST second", "10:00", "url");

			expect(
				showingAt(alertsFor([first, second], DEFAULTS), at("09:56"))
					?.appointment.name,
			).toBe(first.name);
		});
	});

	it("ignores an appointment whose alert has timed out", () => {
		expect(showingAt(alertsFor([CALL], DEFAULTS), at("10:05"))).toBeUndefined();
	});
});

describe("nextOpensAt", () => {
	const alerts = alertsFor([CALL, ACROSS_TOWN], DEFAULTS);

	it("finds nothing when every window has already opened", () => {
		expect(nextOpensAt(alerts, at("09:56"))).toBeUndefined();
	});

	it("finds the soonest window still ahead", () => {
		expect(nextOpensAt(alerts, at("09:00"))).toStrictEqual(at("09:30"));
	});

	// This is what stops the program sleeping through a sooner appointment's
	// alert while a longer one is on screen.
	it("finds a window that opens while another alert is up", () => {
		expect(nextOpensAt(alerts, at("09:35"))).toStrictEqual(at("09:55"));
	});

	it("never points backwards", () => {
		const now = at("09:40");

		expect(nextOpensAt(alerts, now)?.getTime()).toBeGreaterThan(now.getTime());
	});
});

describe("LEAD_MINUTES", () => {
	// The sound is for everything with no physical location, which is two of
	// these three kinds -- so the file has to be able to move them apart even
	// though the defaults agree.
	it("keeps a link and an unlabelled entry as separate kinds", () => {
		expect(Object.keys(LEAD_MINUTES)).toContain("url");
		expect(Object.keys(LEAD_MINUTES)).toContain("plain");
	});

	it("warns further ahead for a place than for anything else", () => {
		expect(LEAD_MINUTES.located).toBeGreaterThan(LEAD_MINUTES.url);
		expect(LEAD_MINUTES.located).toBeGreaterThan(LEAD_MINUTES.plain);
	});

	// The defaults are in minutes and the sound's numbers are in seconds, which
	// is the sort of thing that is obvious in the file and easy to get wrong in
	// the code.
	it("reads the leads as minutes and the sound as seconds", () => {
		expect(DEFAULTS.leads.url).toBe(LEAD_MINUTES.url * MS_PER_MINUTE);
		expect(DEFAULTS.sound.leadMs).toBe(30 * MS_PER_SECOND);
	});
});
