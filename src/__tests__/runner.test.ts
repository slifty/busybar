import { describe, expect, it } from "vitest";
import { delayFor } from "../runner.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;
const RETRY_DELAY_MS = 5_000;

describe("delayFor", () => {
	it("passes an ordinary delay through untouched", () => {
		expect(delayFor(1_000)).toBe(1_000);
	});

	it("allows zero, which asks for a redraw as soon as possible", () => {
		expect(delayFor(0)).toBe(0);
	});

	// setTimeout keeps its delay in a signed 32-bit millisecond count, and
	// anything larger wraps round and fires immediately.
	it("caps a wait longer than setTimeout can express", () => {
		expect(delayFor(MAX_TIMEOUT_MS + 1)).toBe(MAX_TIMEOUT_MS);
		expect(delayFor(Number.MAX_SAFE_INTEGER)).toBe(MAX_TIMEOUT_MS);
	});

	it("never returns a delay setTimeout would fire immediately on", () => {
		for (const requested of [
			-1,
			-MAX_TIMEOUT_MS,
			Number.NaN,
			Number.POSITIVE_INFINITY,
			Number.NEGATIVE_INFINITY,
			MAX_TIMEOUT_MS * 2,
		]) {
			const delay = delayFor(requested);

			expect(Number.isFinite(delay)).toBe(true);
			expect(delay).toBeGreaterThanOrEqual(0);
			expect(delay).toBeLessThanOrEqual(MAX_TIMEOUT_MS);
		}
	});

	it("floors a negative delay at zero rather than counting backwards", () => {
		expect(delayFor(-1)).toBe(0);
	});

	// A program cannot ask for these on purpose, so they are a bug rather than
	// a request. Retrying on the runner's own delay keeps the program alive
	// without spinning the event loop.
	it.each([
		["NaN", Number.NaN],
		["positive infinity", Number.POSITIVE_INFINITY],
		["negative infinity", Number.NEGATIVE_INFINITY],
	])("retries later when asked for %s", (_label, requested) => {
		expect(delayFor(requested)).toBe(RETRY_DELAY_MS);
	});
});
