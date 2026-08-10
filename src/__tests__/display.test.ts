import { describe, expect, it } from "vitest";
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

		await showError(fake.bar, PROGRAM_NAME);

		expect(fake.draws).toHaveLength(1);
		expect(fake.draws[0]?.application_name).toBe(PROGRAM_NAME);
	});

	// Two text elements on 72x16 leaves both unreadable.
	it("replaces what the program had on screen rather than landing on it", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, PROGRAM_NAME);

		expect(fake.clears).toStrictEqual([{ application_name: PROGRAM_NAME }]);
	});

	it("names the program that is failing", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, PROGRAM_NAME);

		const text = (fake.draws[0]?.elements ?? []).find(isText);

		expect(text?.text).toContain(PROGRAM_NAME);
	});

	// An error that expired would hand the screen back to the clock while the
	// tool was still broken, which is the impression it exists to prevent.
	it("stays up until something takes it down", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, PROGRAM_NAME);

		for (const element of fake.draws[0]?.elements ?? []) {
			expect(element.timeout).toBe(0);
			expect(element.display_until).toBeUndefined();
		}
	});

	it("draws in red", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, PROGRAM_NAME);

		const text = (fake.draws[0]?.elements ?? []).find(isText);

		expect(text?.color.toUpperCase()).toMatch(/^#FF0000/v);
	});

	// Program names run longer than 72px of `small` glyphs.
	it("lets a name too wide for the display scroll instead of clipping", async () => {
		const fake = createFakeBar();

		await showError(fake.bar, "random-emoji");

		const text = (fake.draws[0]?.elements ?? []).find(isText);

		expect(text?.scroll_rate).toBeGreaterThan(0);
		expect(text?.width).toBeGreaterThan(0);
	});
});
