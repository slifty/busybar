import { describe as group, expect, it } from "vitest";
import { describe } from "../errors.ts";

group("describe", () => {
	it("is the message of an ordinary error", () => {
		expect(describe(new Error("device said no"))).toBe("device said no");
	});

	// The message that explains what went wrong is usually the innermost one:
	// "could not read focus.json" is only useful next to the ENOENT under it.
	it("appends the cause an error was raised from", () => {
		const error = new Error("could not read focus.json", {
			cause: new Error("ENOENT"),
		});

		expect(describe(error)).toBe("could not read focus.json: ENOENT");
	});

	it("follows a chain of causes the whole way down", () => {
		const error = new Error("could not start", {
			cause: new Error("could not read focus.json", {
				cause: new Error("ENOENT"),
			}),
		});

		expect(describe(error)).toBe(
			"could not start: could not read focus.json: ENOENT",
		);
	});

	// Anything can be thrown in JavaScript, and a report that came back empty
	// for the odd ones would lose exactly the case nobody expected.
	it.each([
		["a string", "not an error at all", "not an error at all"],
		["a number", 409, "409"],
		["undefined", undefined, "undefined"],
		["an object", { status: 409 }, "[object Object]"],
	])("puts %s into words too", (_label, thrown, expected) => {
		expect(describe(thrown)).toBe(expected);
	});
});
