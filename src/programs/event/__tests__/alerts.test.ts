import { describe, expect, it } from "vitest";
import { MS_PER_MINUTE } from "../../../constants/time.ts";
import { sectionOf } from "../../../test/config.ts";
import {
	alertFor,
	alertsFor,
	isShowing,
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

// What the program does when nobody has written a `leads` block, which is the
// arrangement every one of these is about unless it says otherwise.
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

	it("leaves the kinds the file said nothing about at their defaults", () => {
		const settings = settingsOf({ leads: { located: 1 } });

		expect(alertFor(CALL, settings).opensAt.toISOString()).toBe(
			at("09:55").toISOString(),
		);
	});

	// The alert's whole job is getting you there on time, which is over once it
	// is time.
	it("ends when the appointment starts", () => {
		expect(alertFor(CALL, DEFAULTS).endsAt.toISOString()).toBe(
			at("10:00").toISOString(),
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

	// The drawing carries the alert's end as its expiry, so the device takes it
	// down at exactly this instant.
	it("stops the instant the appointment starts", () => {
		expect(isShowing(alert, at("10:00"))).toBe(false);
	});

	it("is not showing once the appointment has begun", () => {
		expect(isShowing(alert, at("10:30"))).toBe(false);
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

		// And hands it back once the sooner one has begun and stopped showing.
		it("returns to the longer alert once the sooner one has started", () => {
			expect(showingAt(overlapping, at("09:46"))?.appointment.name).toBe(
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

	it("ignores an appointment that has already started", () => {
		expect(showingAt(alertsFor([CALL], DEFAULTS), at("10:01"))).toBeUndefined();
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
	// A link and an unlabelled entry agree on a number and are still two
	// different statements, so the file has to be able to move them apart.
	it("keeps a link and an unlabelled entry as separate kinds", () => {
		expect(Object.keys(LEAD_MINUTES)).toContain("url");
		expect(Object.keys(LEAD_MINUTES)).toContain("plain");
	});

	it("warns further ahead for a place than for anything else", () => {
		expect(LEAD_MINUTES.located).toBeGreaterThan(LEAD_MINUTES.url);
		expect(LEAD_MINUTES.located).toBeGreaterThan(LEAD_MINUTES.plain);
	});

	// The defaults are written in minutes and carried in milliseconds.
	it("reads the leads as minutes", () => {
		expect(DEFAULTS.leads.url).toBe(LEAD_MINUTES.url * MS_PER_MINUTE);
	});
});
