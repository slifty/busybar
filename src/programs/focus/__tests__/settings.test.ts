import { describe, expect, it } from "vitest";
import { sectionOf } from "../../../test/config.ts";
import { DEFAULT_FOCUS_FILE, focusSettings } from "../settings.ts";

describe("focusSettings", () => {
	it("reads the calendar and the schedule file", () => {
		const settings = focusSettings(
			sectionOf({
				calendar: "https://example.test/basic.ics",
				file: "local/somewhere.json",
			}),
		);

		expect(settings.calendar).toBe("https://example.test/basic.ics");
		expect(settings.file).toBe("local/somewhere.json");
	});

	// The default is what you get by configuring nothing at all, and `local/`
	// is git-ignored, which is why the schedule lives there.
	it("falls back to the default schedule file", () => {
		expect(focusSettings(sectionOf({})).file).toBe(DEFAULT_FOCUS_FILE);
	});

	// No calendar is not a default calendar: it is what puts the schedule file
	// in charge.
	it("has no calendar unless one is written", () => {
		expect(focusSettings(sectionOf({})).calendar).toBeUndefined();
	});

	it("says where a setting is written, for a message about fixing it", () => {
		expect(focusSettings(sectionOf({})).where("file")).toMatch(
			/programs\.test-program\.file/v,
		);
	});
});
