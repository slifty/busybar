import { describe, expect, it } from "vitest";
import { isFetchable } from "../source.ts";

describe("isFetchable", () => {
	it.each(["http://example.test/basic.ics", "https://example.test/basic.ics"])(
		"fetches %s",
		(source) => {
			expect(isFetchable(source)).toBe(true);
		},
	);

	// Told apart by parsing the source as a URL rather than by looking for a
	// slash or a dot, so a relative path with either in it stays a path.
	it.each([
		"local/focus.ics",
		"/absolute/focus.ics",
		"./focus.ics",
		"focus.ics",
		"file:///tmp/focus.ics",
	])("opens %s", (source) => {
		expect(isFetchable(source)).toBe(false);
	});
});
