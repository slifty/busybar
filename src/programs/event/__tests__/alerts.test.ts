import { describe, expect, it } from "vitest";
import { alertAt, nextAlertOpensAt } from "../alerts.ts";
import { LEAD_MINUTES, alertOpensAt, isAlerting } from "../appointment.ts";
import type { Appointment, Kind } from "../appointment.ts";

const at = (time: string): Date => new Date(`2026-01-02T${time}:00Z`);

const appointment = (name: string, start: string, kind: Kind): Appointment => ({
	name,
	start: at(start),
	kind,
});

// Named for the shape being tested rather than for anything anybody does.
const CALL = appointment("TEST call", "10:00", "url");
const ACROSS_TOWN = appointment("TEST across town", "10:00", "located");

describe("alertOpensAt", () => {
	it.each([
		["url", "url" as const, "09:55"],
		["located", "located" as const, "09:30"],
		["plain", "plain" as const, "09:55"],
	])("opens the %s window at its lead", (_label, kind, expected) => {
		expect(alertOpensAt(appointment("TEST", "10:00", kind)).toISOString()).toBe(
			at(expected).toISOString(),
		);
	});

	// The distinction the whole program exists for: somewhere to be gets the
	// warning that covers getting there.
	it("gives a place more warning than a link", () => {
		expect(alertOpensAt(ACROSS_TOWN).getTime()).toBeLessThan(
			alertOpensAt(CALL).getTime(),
		);
	});
});

describe("isAlerting", () => {
	it("is not alerting before the window opens", () => {
		expect(isAlerting(CALL, at("09:54"))).toBe(false);
	});

	it("is alerting the instant the window opens", () => {
		expect(isAlerting(CALL, at("09:55"))).toBe(true);
	});

	it("is alerting inside the window", () => {
		expect(isAlerting(CALL, at("09:58"))).toBe(true);
	});

	// The alert's whole job is getting you there on time, which is over once
	// it is time. The drawing carries the start as its expiry, so the device
	// takes it down at exactly this instant.
	it("stops the instant the appointment starts", () => {
		expect(isAlerting(CALL, at("10:00"))).toBe(false);
	});

	it("is not alerting once it has begun", () => {
		expect(isAlerting(CALL, at("10:30"))).toBe(false);
	});
});

describe("alertAt", () => {
	it("finds nothing when nothing is close enough", () => {
		expect(alertAt([CALL, ACROSS_TOWN], at("09:00"))).toBeUndefined();
	});

	it("finds the one appointment whose window is open", () => {
		expect(alertAt([CALL, ACROSS_TOWN], at("09:40"))?.name).toBe(
			ACROSS_TOWN.name,
		);
	});

	// Overlapping alerts are ordinary rather than a conflict: a distant
	// appointment with a long lead runs into a near one with a short lead, and
	// both are real. What has to be decided is which owns the display.
	describe("when two alerts overlap", () => {
		const LATER_BUT_ALERTING = appointment("TEST later", "10:00", "located");
		const SOONER = appointment("TEST sooner", "09:45", "url");

		it("gives the screen to whichever starts soonest", () => {
			expect(alertAt([LATER_BUT_ALERTING, SOONER], at("09:41"))?.name).toBe(
				SOONER.name,
			);
		});

		// Sorting by start rather than by which spoke first is what makes the
		// more urgent win, whichever had the screen.
		it("takes the screen from an alert that was already up", () => {
			const before = alertAt([LATER_BUT_ALERTING, SOONER], at("09:39"));
			const after = alertAt([LATER_BUT_ALERTING, SOONER], at("09:41"));

			expect(before?.name).toBe(LATER_BUT_ALERTING.name);
			expect(after?.name).toBe(SOONER.name);
		});

		// And hands it back once the sooner one has begun and stopped alerting.
		it("returns to the longer alert once the sooner one has started", () => {
			expect(alertAt([LATER_BUT_ALERTING, SOONER], at("09:46"))?.name).toBe(
				LATER_BUT_ALERTING.name,
			);
		});

		// `sort` is stable, so leaving equal starts untouched preserves the
		// order they were read in.
		it("settles an exact tie by the order they were read", () => {
			const first = appointment("TEST first", "10:00", "url");
			const second = appointment("TEST second", "10:00", "url");

			expect(alertAt([first, second], at("09:56"))?.name).toBe(first.name);
		});
	});

	it("ignores an appointment that has already started", () => {
		expect(alertAt([CALL], at("10:01"))).toBeUndefined();
	});
});

describe("nextAlertOpensAt", () => {
	it("finds nothing when every window has already opened", () => {
		expect(nextAlertOpensAt([CALL], at("09:56"))).toBeUndefined();
	});

	it("finds the soonest window still ahead", () => {
		expect(nextAlertOpensAt([CALL, ACROSS_TOWN], at("09:00"))).toStrictEqual(
			at("09:30"),
		);
	});

	// This is what stops the program sleeping through a sooner appointment's
	// alert while a longer one is on screen.
	it("finds a window that opens while another alert is up", () => {
		expect(nextAlertOpensAt([CALL, ACROSS_TOWN], at("09:35"))).toStrictEqual(
			at("09:55"),
		);
	});

	it("never points backwards", () => {
		const now = at("09:40");
		const opens = nextAlertOpensAt([CALL, ACROSS_TOWN], now);

		expect(opens?.getTime()).toBeGreaterThan(now.getTime());
	});
});

describe("LEAD_MINUTES", () => {
	// The version that gains sound and a button will need these apart, since
	// the thirty-second alert is for everything with no physical location --
	// which is two of these three kinds.
	it("keeps a link and an unlabelled entry as separate kinds", () => {
		expect(Object.keys(LEAD_MINUTES)).toContain("url");
		expect(Object.keys(LEAD_MINUTES)).toContain("plain");
	});

	it("warns further ahead for a place than for anything else", () => {
		expect(LEAD_MINUTES.located).toBeGreaterThan(LEAD_MINUTES.url);
		expect(LEAD_MINUTES.located).toBeGreaterThan(LEAD_MINUTES.plain);
	});
});
