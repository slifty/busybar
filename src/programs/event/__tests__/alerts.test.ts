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
import type { Appointment } from "../appointment.ts";
import type { EventSettings } from "../settings.ts";

const at = (time: string): Date => new Date(`2026-01-02T${time}:00Z`);

const appointment = (
	name: string,
	start: string,
	alarms: string[] = [],
): Appointment => ({
	name,
	start: at(start),
	alarms: alarms.map(at),
});

// What the program does when nobody has written a `lead` or `sound` block,
// which is the arrangement every one of these is about unless it says
// otherwise.
const DEFAULTS: EventSettings = eventSettings(sectionOf());

const settingsOf = (values: Record<string, unknown>): EventSettings =>
	eventSettings(sectionOf(values));

// Named for the shape being tested rather than for anything anybody does.
const CALL = appointment("TEST call", "10:00");

describe("alertFor", () => {
	it("opens the window at the lead", () => {
		expect(alertFor(CALL, DEFAULTS).opensAt.toISOString()).toBe(
			at("09:55").toISOString(),
		);
	});

	// One lead for everything, so two appointments at the same time are the
	// same alert.
	it("gives two appointments starting together the same window", () => {
		const other = appointment("TEST other", "10:00");

		expect(alertFor(other, DEFAULTS)).toStrictEqual({
			...alertFor(CALL, DEFAULTS),
			appointment: other,
		});
	});

	// How far away somebody's meetings are is a fact about their day, and the
	// file is where a fact like that gets stated.
	it("takes the lead from the file when the file says one", () => {
		const settings = settingsOf({ lead: 1 });

		expect(alertFor(CALL, settings).opensAt.toISOString()).toBe(
			at("09:59").toISOString(),
		);
	});

	it("starts making a noise half a minute out", () => {
		expect(alertFor(CALL, DEFAULTS).soundsFrom.toISOString()).toBe(
			new Date("2026-01-02T09:59:30Z").toISOString(),
		);
	});

	// It is meant to continue until it is acknowledged, and an unattended bar
	// acknowledges nothing -- so something has to end it.
	it("keeps going past the start rather than stopping there", () => {
		expect(alertFor(CALL, DEFAULTS).endsAt.getTime()).toBeGreaterThan(
			CALL.start.getTime(),
		);
	});

	it("stops when the file says to stop", () => {
		const settings = settingsOf({ sound: { linger: 30 } });

		expect(alertFor(CALL, settings).endsAt.toISOString()).toBe(
			new Date("2026-01-02T10:00:30Z").toISOString(),
		);
	});

	// A file is free to set a warning shorter than the sound's own lead, and a
	// bar chiming about an appointment it is not naming is alarming and
	// useless in the same breath.
	it("is on screen by the time it makes a noise, whatever the file says", () => {
		const settings = settingsOf({ lead: 0, sound: { lead: 60 } });
		const alert = alertFor(CALL, settings);

		expect(alert.opensAt.getTime()).toBeLessThanOrEqual(
			alert.soundsFrom.getTime(),
		);
	});

	// A VALARM is the calendar saying how much warning it wants, which is the
	// one per-appointment answer to that question there is.
	describe("when the calendar carries its own alarms", () => {
		it("opens at the alarm rather than at the lead", () => {
			const early = appointment("TEST early", "10:00", ["09:30"]);

			expect(alertFor(early, DEFAULTS).opensAt.toISOString()).toBe(
				at("09:30").toISOString(),
			);
		});

		// The alarm replaces the lead rather than adding to it, so an entry
		// asking for less warning than everything else gets less. `lead` is
		// what to do when an entry says nothing, not a floor under what it
		// says.
		it("opens later than the lead when the alarm asks for less", () => {
			const late = appointment("TEST late", "10:00", ["09:58"]);

			expect(alertFor(late, DEFAULTS).opensAt.toISOString()).toBe(
				at("09:58").toISOString(),
			);
		});

		// Except that it is always on screen by the time it chimes: a bar
		// making a noise about something it is not naming is alarming and
		// unhelpful in the same breath.
		it("is still on screen by the time it chimes", () => {
			const atStart = appointment("TEST at start", "10:00", ["10:00"]);
			const alert = alertFor(atStart, DEFAULTS);

			expect(alert.opensAt.toISOString()).toBe(
				new Date("2026-01-02T09:59:30Z").toISOString(),
			);
			expect(alert.opensAt.getTime()).toBeLessThanOrEqual(
				alert.soundsFrom.getTime(),
			);
		});

		it("takes the earliest when there are several", () => {
			const several = appointment("TEST several", "10:00", [
				"09:30",
				"09:50",
				"10:00",
			]);

			expect(alertFor(several, DEFAULTS).opensAt.toISOString()).toBe(
				at("09:30").toISOString(),
			);
		});

		it("keeps the lead for an appointment that carries none", () => {
			const quiet = appointment("TEST quiet", "10:00", []);

			expect(alertFor(quiet, DEFAULTS).opensAt.toISOString()).toBe(
				at("09:55").toISOString(),
			);
		});

		// The alarm says when to start speaking, not when to stop or when to
		// start chiming: those stay measured from the appointment itself.
		it("leaves the chime and the ending where they were", () => {
			const early = appointment("TEST early", "10:00", ["09:30"]);
			const alert = alertFor(early, DEFAULTS);

			expect(alert.soundsFrom.toISOString()).toBe(
				new Date("2026-01-02T09:59:30Z").toISOString(),
			);
			expect(alert.endsAt.toISOString()).toBe(
				new Date("2026-01-02T10:02:00Z").toISOString(),
			);
		});
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
});

describe("showingAt", () => {
	// Windows of [start - 5m, start + 2m], so these two overlap from 09:55 to
	// 10:00 -- which is what a pair of back-to-back meetings looks like now
	// that the lead is the same for both.
	const SOONER = appointment("TEST sooner", "09:58");
	const LATER = appointment("TEST later", "10:00");

	// Read in the order that would be wrong to keep: the sort has to resolve
	// two open windows by which appointment is nearer rather than by which the
	// feed listed first.
	const alerts = alertsFor([LATER, SOONER], DEFAULTS);

	it("finds nothing when nothing is close enough", () => {
		expect(showingAt(alerts, at("09:00"))).toBeUndefined();
	});

	it("finds the one appointment whose window is open", () => {
		expect(showingAt(alerts, at("09:54"))?.appointment.name).toBe(SOONER.name);
	});

	describe("when two alerts overlap", () => {
		it("gives the screen to whichever starts soonest", () => {
			expect(showingAt(alerts, at("09:56"))?.appointment.name).toBe(
				SOONER.name,
			);
		});

		// And hands it on once the sooner one has stopped -- which, since the
		// noise outlasts the start, is after its linger rather than at its own
		// start.
		it("moves to the later alert once the sooner one is done", () => {
			expect(showingAt(alerts, at("10:01"))?.appointment.name).toBe(LATER.name);
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

	it("ignores an appointment whose alert has timed out", () => {
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

	// This is what stops the program sleeping through the next appointment's
	// alert while one is already on screen.
	it("finds a window that opens while another alert is up", () => {
		expect(nextOpensAt(alerts, at("09:54"))).toStrictEqual(at("09:55"));
	});

	it("never points backwards", () => {
		const now = at("09:54");

		expect(nextOpensAt(alerts, now)?.getTime()).toBeGreaterThan(now.getTime());
	});
});

describe("LEAD_MINUTES", () => {
	// The defaults are in minutes and the sound's numbers are in seconds, which
	// is the sort of thing that is obvious in the file and easy to get wrong in
	// the code.
	it("reads the lead as minutes and the sound as seconds", () => {
		expect(DEFAULTS.leadMs).toBe(LEAD_MINUTES * MS_PER_MINUTE);
		expect(DEFAULTS.sound.leadMs).toBe(30 * MS_PER_SECOND);
	});

	// Short enough to be about clicking something rather than about crossing
	// town: an appointment that needs more than this has to say so itself.
	it("is five minutes", () => {
		expect(LEAD_MINUTES).toBe(5);
	});
});
