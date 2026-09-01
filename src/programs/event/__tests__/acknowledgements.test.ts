import { describe, expect, it } from "vitest";
import { createAcknowledgements } from "../acknowledgements.ts";
import type { Appointment } from "../appointment.ts";

const appointment = (name: string, start: string): Appointment => ({
	name,
	start: new Date(`2026-01-02T${start}:00Z`),
	alarms: [],
});

const CALL = appointment("TEST call", "10:00");
const LATER = appointment("TEST later", "11:00");

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

	// An appointment is looked up by what the bar knows about it, which is
	// everything it drew. A meeting moved to a different time is a different
	// alert and has not been answered.
	it("does not count a moved appointment as answered", () => {
		const answered = createAcknowledgements();

		answered.acknowledge(CALL);

		expect(answered.has(appointment(CALL.name, "10:30"))).toBe(false);
	});

	// Two calendars carrying the same meeting produce two appointments, and the
	// bar was only ever showing one alert.
	it("answers the same meeting read from two calendars at once", () => {
		const answered = createAcknowledgements();

		answered.acknowledge(CALL);

		expect(answered.has(appointment(CALL.name, "10:00"))).toBe(true);
	});

	describe("keepOnly", () => {
		it("forgets an appointment nothing can name any more", () => {
			const answered = createAcknowledgements();

			answered.acknowledge(CALL);
			answered.keepOnly([LATER]);

			expect(answered.has(CALL)).toBe(false);
		});

		it("keeps an appointment that is still in the calendars", () => {
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
