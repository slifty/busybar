import { describe, expect, it } from "vitest";
import { createAcknowledgements } from "../acknowledgements.ts";
import type { Alert } from "../alerts.ts";

const at = (time: string): Date => new Date(`2026-01-02T${time}:00Z`);

// Only the appointment and the trigger are looked at, so the rest of an alert
// is filled in with the instants a trigger at the start would produce.
const alert = (name: string, start: string, trigger = start): Alert => ({
	appointment: { name, start: at(start), alarms: [at(trigger)] },
	trigger: at(trigger),
	opensAt: at(trigger),
	endsAt: at(trigger),
	soundsFrom: at(trigger),
	chimesUntil: at(trigger),
});

const CALL = alert("TEST call", "10:00");
const LATER = alert("TEST later", "11:00");

describe("createAcknowledgements", () => {
	it("has answered nothing to begin with", () => {
		expect(createAcknowledgements().has(CALL)).toBe(false);
	});

	it("remembers what was answered", () => {
		const answered = createAcknowledgements();

		answered.acknowledge(CALL);

		expect(answered.has(CALL)).toBe(true);
	});

	// Acknowledging is about one alert rather than about the day.
	it("leaves the rest of the day alone", () => {
		const answered = createAcknowledgements();

		answered.acknowledge(CALL);

		expect(answered.has(LATER)).toBe(false);
	});

	// The whole reason a calendar carries two alarms is that they are two
	// interruptions. Answering the one that came early must not silence the one
	// that catches you on the way out.
	it("leaves another alarm on the same appointment alone", () => {
		const answered = createAcknowledgements();
		const early = alert("TEST call", "10:00", "09:00");

		answered.acknowledge(early);

		expect(answered.has(CALL)).toBe(false);
	});

	// An appointment is looked up by what the bar knows about it, which is
	// everything it drew. A meeting moved to a different time is a different
	// alert and has not been answered.
	it("does not count a moved appointment as answered", () => {
		const answered = createAcknowledgements();

		answered.acknowledge(CALL);

		expect(answered.has(alert("TEST call", "10:30"))).toBe(false);
	});

	// Two calendars carrying the same meeting produce two alerts, and the bar
	// was only ever showing one of them.
	it("answers the same meeting read from two calendars at once", () => {
		const answered = createAcknowledgements();

		answered.acknowledge(CALL);

		expect(answered.has(alert("TEST call", "10:00"))).toBe(true);
	});

	describe("keepOnly", () => {
		it("forgets an alert nothing can name any more", () => {
			const answered = createAcknowledgements();

			answered.acknowledge(CALL);
			answered.keepOnly([LATER]);

			expect(answered.has(CALL)).toBe(false);
		});

		it("keeps an alert that is still in the calendars", () => {
			const answered = createAcknowledgements();

			answered.acknowledge(CALL);
			answered.keepOnly([CALL, LATER]);

			expect(answered.has(CALL)).toBe(true);
		});

		// What this is for is that the set cannot grow for as long as the
		// process runs. A day with nothing left in it empties it entirely.
		it("forgets everything when nothing is left in the calendars", () => {
			const answered = createAcknowledgements();

			answered.acknowledge(CALL);
			answered.acknowledge(LATER);
			answered.keepOnly([]);

			expect(answered.has(CALL)).toBe(false);
			expect(answered.has(LATER)).toBe(false);
		});
	});
});
