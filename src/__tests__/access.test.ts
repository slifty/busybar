import { describe, expect, it } from "vitest";
import { explainRefusal, isRefused } from "../access.ts";
import { configOf } from "../test/config.ts";
import { describe as describeError } from "../errors.ts";

// busy-lib surfaces a refused request as a plain Error carrying the status.
const withStatus = (status: number): Error =>
	Object.assign(new Error("Forbidden"), { status });

// Not an address anything answers at: `.test` is reserved for exactly this, so
// it cannot be mistaken for somebody's bar. Nothing here connects to it.
const MOCK_BUSYBAR_ADDRESS = "mock-busybar.test";

describe("isRefused", () => {
	it("recognises what the bar answers without the key", () => {
		expect(isRefused(withStatus(403))).toBe(true);
	});

	it("recognises being asked to say who is calling", () => {
		expect(isRefused(withStatus(401))).toBe(true);
	});

	it("does not mistake other failures for a refusal", () => {
		for (const error of [
			withStatus(409),
			withStatus(500),
			new Error("connection refused"),
			"not an error",
		]) {
			expect(isRefused(error)).toBe(false);
		}
	});
});

describe("explainRefusal", () => {
	const unlocked = { ...configOf(), deviceAddress: MOCK_BUSYBAR_ADDRESS };
	const locked = { ...unlocked, devicePassword: "0123" };

	describe("when no password was sent", () => {
		const explained = describeError(explainRefusal(withStatus(403), unlocked));

		it("says which bar refused", () => {
			expect(explained).toMatch(
				/the bar at mock-busybar\.test refused access/v,
			);
		});

		it("names the setting to write, and the file to write it in", () => {
			expect(explained).toMatch(/set device\.password in test-config\.yml/v);
		});

		it("keeps what the bar said", () => {
			expect(explained).toMatch(/Forbidden$/v);
		});
	});

	describe("when the password that was sent was refused", () => {
		const explained = describeError(explainRefusal(withStatus(403), locked));

		it("says the password is the thing to look at", () => {
			expect(explained).toMatch(
				/device\.password in test-config\.yml is not the key/v,
			);
		});

		// The bar answers the same way when it is not taking requests from the
		// network at all, so the password may be right.
		it("allows that access may simply be off", () => {
			expect(explained).toMatch(/HTTP access is turned off/v);
		});

		// It is a credential, and this line goes to a terminal and a log.
		it("does not repeat the password", () => {
			expect(explained).not.toMatch(/0123/v);
		});
	});
});
