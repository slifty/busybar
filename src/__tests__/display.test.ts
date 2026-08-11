import { describe, expect, it } from "vitest";
import { DEFAULT_DRAW_PRIORITY } from "../constants/device.ts";
import { clearApplication, isPreempted, showError } from "../display.ts";
import { createFakeBar } from "../test/bar.ts";
import type { BusyBar } from "@busy-app/busy-lib";

type Elements = Parameters<BusyBar["DisplayDraw"]>[0]["elements"];
type Element = Elements[number];

const isText = (
	element: Element,
): element is Extract<Element, { type: "text" }> => element.type === "text";

const PROGRAM_NAME = "focus";

// The device rejects a draw with 409 when a higher-priority app owns the
// screen. busy-lib surfaces that as a plain Error carrying the status.
const withStatus = (status: number): Error =>
	Object.assign(new Error("nope"), { status });

describe("isPreempted", () => {
	it("recognises the conflict the device answers with when outranked", () => {
		expect(isPreempted(withStatus(409))).toBe(true);
	});

	it("does not mistake other failures for preemption", () => {
		for (const error of [
			withStatus(500),
			withStatus(404),
			new Error("connection refused"),
			"not an error at all",
			undefined,
			// A `status` that is not a number at all: the property is read off an
			// unknown value, so nothing guarantees what it holds.
			Object.assign(new Error("odd"), { status: "409" }),
		]) {
			expect(isPreempted(error)).toBe(false);
		}
	});
});

describe("clearApplication", () => {
	it("clears only the application it was given", async () => {
		const fake = createFakeBar();

		await clearApplication(fake.bar, PROGRAM_NAME);

		expect(fake.clears).toStrictEqual([{ application_name: PROGRAM_NAME }]);
	});
});

describe("showError", () => {
	// The device settles a tie on priority in favour of whichever application
	// already owns the screen, so an error under any other name would be one
	// the program could not draw over -- and the recovery that clears it would
	// be the thing it blocked.
	it("draws under the program's own application name", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, PROGRAM_NAME, DEFAULT_DRAW_PRIORITY);

		expect(fake.draws).toHaveLength(1);
		expect(fake.draws[0]?.application_name).toBe(PROGRAM_NAME);
	});

	// Two text elements on 72x16 leaves both unreadable.
	it("replaces what the program had on screen rather than landing on it", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, PROGRAM_NAME, DEFAULT_DRAW_PRIORITY);

		expect(fake.clears).toStrictEqual([{ application_name: PROGRAM_NAME }]);
	});

	// A program that outranks the others is one whose failure has to outrank
	// them too: drawn at the default, the failure of the program that
	// interrupts everything else would be the one failure nothing could see.
	it("draws at the priority the failing program speaks at", async () => {
		const fake = createFakeBar();
		const interrupting = DEFAULT_DRAW_PRIORITY + 1;

		await showError(fake.bar, PROGRAM_NAME, interrupting);

		expect(fake.draws[0]?.priority).toBe(interrupting);
	});

	it("names the program that is failing", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, PROGRAM_NAME, DEFAULT_DRAW_PRIORITY);

		const text = (fake.draws[0]?.elements ?? []).find(isText);

		expect(text?.text).toContain(PROGRAM_NAME);
	});

	// An error that expired would hand the screen back to the clock while the
	// tool was still broken, which is the impression it exists to prevent.
	it("stays up until something takes it down", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, PROGRAM_NAME, DEFAULT_DRAW_PRIORITY);

		for (const element of fake.draws[0]?.elements ?? []) {
			expect(element.timeout).toBe(0);
			expect(element.display_until).toBeUndefined();
		}
	});

	it("draws in red", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, PROGRAM_NAME, DEFAULT_DRAW_PRIORITY);

		const text = (fake.draws[0]?.elements ?? []).find(isText);

		expect(text?.color.toUpperCase()).toMatch(/^#FF0000/v);
	});

	// A failure is meant to be taken in at a glance from across the room, and
	// scrolling text is a thing you have to stand and wait for.
	it("sizes a long name down rather than scrolling it", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, "random-emoji", DEFAULT_DRAW_PRIORITY);

		const texts = (fake.draws[0]?.elements ?? []).filter(isText);

		expect(texts.length).toBeGreaterThan(0);

		for (const text of texts) {
			expect(text.scroll_rate).toBeUndefined();
			expect(text.width).toBeUndefined();
		}
	});

	// Whatever it takes -- a smaller font, more lines -- the whole of it is
	// there to read.
	it("keeps the whole message, across lines if it has to", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, "random-emoji", DEFAULT_DRAW_PRIORITY);

		const drawn = (fake.draws[0]?.elements ?? [])
			.filter(isText)
			.map(({ text }) => text)
			.join(" ");

		expect(drawn).toContain("random-emoji");
		expect(drawn).toContain("ERROR");
	});
});
