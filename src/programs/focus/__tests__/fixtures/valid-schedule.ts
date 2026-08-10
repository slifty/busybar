// A schedule the loader should accept whole: two blocks that do not overlap,
// one name carrying characters the display cannot render.
const VALID_SCHEDULE = [
	{
		name: "Deep Work",
		start: "2026-01-01T09:00:00Z",
		end: "2026-01-01T10:30:00Z",
	},
	{
		name: "🎯 Focus: Q3 — Roadmap",
		start: "2026-01-01T11:00:00Z",
		end: "2026-01-01T12:00:00Z",
	},
];

export { VALID_SCHEDULE };
