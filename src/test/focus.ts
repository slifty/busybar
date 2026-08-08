import type { Focus } from "../programs/focus/focus.ts";

const DEFAULT_START = new Date("2026-01-01T09:00:00Z");
const DEFAULT_END = new Date("2026-01-01T10:00:00Z");

// Builds a focus block, letting a test name only the parts it cares about.
const createFocus = (overrides: Partial<Focus> = {}): Focus => ({
	name: "Deep Work",
	start: DEFAULT_START,
	end: DEFAULT_END,
	...overrides,
});

export { createFocus };
