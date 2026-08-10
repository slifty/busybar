import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from "vitest";
import {
	DEFAULT_FOCUS_FILE,
	FOCUS_CALENDAR_ENV_VAR,
	FOCUS_FILE_ENV_VAR,
	drawableName,
	isFetchable,
	loadBlocks,
} from "../blocks.ts";
import { SINGLE_EVENT } from "./fixtures/calendars.ts";
import { VALID_SCHEDULE } from "./fixtures/valid-schedule.ts";

// The loader is given a real file in a temporary directory rather than a mocked
// `fs`. Reading a file is the whole job, so faking it would leave the part
// worth testing untested -- and the error messages a mistyped schedule produces
// are exactly what this needs to pin down.
const directory = mkdtempSync(join(tmpdir(), "busybar-focus-"));

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

afterEach(() => {
	vi.unstubAllEnvs();
});

// Writes a schedule file and points the loader at it, returning nothing so that
// each test reads as "given this file, expect this".
const givenSchedule = async (contents: string): Promise<void> => {
	const path = join(directory, `${String(Math.random()).slice(2)}.json`);

	await writeFile(path, contents, "utf8");
	vi.stubEnv(FOCUS_FILE_ENV_VAR, path);
};

const givenScheduleOf = async (blocks: unknown): Promise<void> => {
	await givenSchedule(JSON.stringify(blocks));
};

describe("drawableName", () => {
	it("leaves printable ASCII alone", () => {
		expect(drawableName("Deep Work")).toBe("Deep Work");
	});

	it.each([
		["an em dash", "Deep — Work", "Deep Work"],
		["curly quotes", "“Deep” Work", "Deep Work"],
		["an emoji", "🎯 Deep Work", "Deep Work"],
		["an accent", "Café Work", "Caf Work"],
	])("drops %s", (_label, given, expected) => {
		expect(drawableName(given)).toBe(expected);
	});

	it("collapses the gap left behind rather than leaving a run of spaces", () => {
		expect(drawableName("Deep 🎯 🎯 Work")).toBe("Deep Work");
	});

	it("returns nothing when there is nothing drawable", () => {
		expect(drawableName("🎯🔥")).toBe("");
	});
});

describe("loadBlocks", () => {
	it("reads a whole schedule", async () => {
		await givenScheduleOf(VALID_SCHEDULE);

		const blocks = await loadBlocks();

		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.name).toBe("Deep Work");
		expect(blocks[0]?.start).toStrictEqual(new Date("2026-01-01T09:00:00Z"));
		expect(blocks[0]?.end).toStrictEqual(new Date("2026-01-01T10:30:00Z"));
	});

	it("sanitises names on the way in, so nothing undrawable reaches the device", async () => {
		await givenScheduleOf(VALID_SCHEDULE);

		const blocks = await loadBlocks();

		expect(blocks[1]?.name).toBe("Focus: Q3 Roadmap");
	});

	it("accepts an empty schedule", async () => {
		await givenScheduleOf([]);

		await expect(loadBlocks()).resolves.toStrictEqual([]);
	});

	// The default is what you get by configuring nothing at all, so it is worth
	// pinning down that it is the path actually read.
	it("falls back to the default file when no path is named", async () => {
		const cwd = process.cwd();

		// Somewhere without a `local/`, so the default resolves to something
		// absent rather than to whatever this checkout happens to be carrying.
		process.chdir(directory);
		vi.stubEnv(FOCUS_FILE_ENV_VAR, undefined);

		try {
			await expect(loadBlocks()).rejects.toThrow(DEFAULT_FOCUS_FILE);
		} finally {
			process.chdir(cwd);
		}
	});

	it("keeps blocks in the order they were written, overlaps and all", async () => {
		await givenScheduleOf([
			{ name: "b", start: "2026-01-01T11:00:00Z", end: "2026-01-01T12:00:00Z" },
			{ name: "a", start: "2026-01-01T09:00:00Z", end: "2026-01-01T10:00:00Z" },
		]);

		const blocks = await loadBlocks();

		expect(blocks.map(({ name }) => name)).toStrictEqual(["b", "a"]);
	});

	describe("refuses to start", () => {
		it("when the file is missing", async () => {
			vi.stubEnv(FOCUS_FILE_ENV_VAR, join(directory, "absent.json"));

			await expect(loadBlocks()).rejects.toThrow(/could not read/v);
		});

		it("naming the environment variable, so the fix is obvious", async () => {
			vi.stubEnv(FOCUS_FILE_ENV_VAR, join(directory, "absent.json"));

			await expect(loadBlocks()).rejects.toThrow(
				new RegExp(FOCUS_FILE_ENV_VAR, "v"),
			);
		});

		it("keeping the underlying failure as the error's cause", async () => {
			vi.stubEnv(FOCUS_FILE_ENV_VAR, join(directory, "absent.json"));

			const error = await loadBlocks().catch((reason: unknown) => reason);

			expect(error).toBeInstanceOf(Error);
			expect(error instanceof Error && error.cause !== undefined).toBe(true);
		});

		it("when the file is not JSON", async () => {
			await givenSchedule("{ not json");

			await expect(loadBlocks()).rejects.toThrow(/is not valid JSON/v);
		});

		it("when the document is not an array", async () => {
			await givenScheduleOf({ name: "Deep Work" });

			await expect(loadBlocks()).rejects.toThrow(/must hold an array/v);
		});

		it("when a block is not an object", async () => {
			await givenScheduleOf(["Deep Work"]);

			await expect(loadBlocks()).rejects.toThrow(/expected an object/v);
		});

		it.each(["name", "start", "end"])("when %s is missing", async (field) => {
			const complete: Record<string, string> = {
				name: "Deep Work",
				start: "2026-01-01T09:00:00Z",
				end: "2026-01-01T10:00:00Z",
			};
			const partial = Object.fromEntries(
				Object.entries(complete).filter(([key]) => key !== field),
			);

			await givenScheduleOf([partial]);

			await expect(loadBlocks()).rejects.toThrow(
				new RegExp(`"${field}" must be a string`, "v"),
			);
		});

		it("when a date cannot be parsed", async () => {
			await givenScheduleOf([
				{ name: "Deep Work", start: "never", end: "2026-01-01T10:00:00Z" },
			]);

			await expect(loadBlocks()).rejects.toThrow(/"start" is not a date/v);
		});

		it("when a block ends before it starts", async () => {
			await givenScheduleOf([
				{
					name: "Deep Work",
					start: "2026-01-01T10:00:00Z",
					end: "2026-01-01T09:00:00Z",
				},
			]);

			await expect(loadBlocks()).rejects.toThrow(
				/"end" must be after "start"/v,
			);
		});

		it("when a block ends exactly when it starts", async () => {
			await givenScheduleOf([
				{
					name: "Deep Work",
					start: "2026-01-01T09:00:00Z",
					end: "2026-01-01T09:00:00Z",
				},
			]);

			await expect(loadBlocks()).rejects.toThrow(
				/"end" must be after "start"/v,
			);
		});

		it("when a name has nothing the display can render", async () => {
			await givenScheduleOf([
				{
					name: "🎯🔥",
					start: "2026-01-01T09:00:00Z",
					end: "2026-01-01T10:00:00Z",
				},
			]);

			await expect(loadBlocks()).rejects.toThrow(
				/nothing the display can render/v,
			);
		});

		it("saying which block is at fault", async () => {
			await givenScheduleOf([
				{
					name: "ok",
					start: "2026-01-01T09:00:00Z",
					end: "2026-01-01T10:00:00Z",
				},
				{
					name: "ok",
					start: "2026-01-01T11:00:00Z",
					end: "2026-01-01T12:00:00Z",
				},
				{ name: "bad", start: "never", end: "2026-01-01T14:00:00Z" },
			]);

			await expect(loadBlocks()).rejects.toThrow(/block 2/v);
		});
	});
});

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

describe("loadBlocks, from a calendar", () => {
	// The fixtures describe fixed dates, and only what falls near now is read.
	const NOW = new Date("2026-01-02T00:00:00Z");

	beforeEach(() => {
		vi.useFakeTimers({ toFake: ["Date"] });
		vi.setSystemTime(NOW);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	const givenCalendarFile = async (contents: string): Promise<void> => {
		const path = join(directory, `${String(Math.random()).slice(2)}.ics`);

		await writeFile(path, contents, "utf8");
		vi.stubEnv(FOCUS_CALENDAR_ENV_VAR, path);
	};

	// Only the response is faked. What is being pinned down is which of the two
	// ways of reading a calendar gets used, and what happens to what comes back.
	const givenCalendarUrl = (response: Response): void => {
		vi.stubEnv(FOCUS_CALENDAR_ENV_VAR, "https://example.test/basic.ics");
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => await Promise.resolve(response)),
		);
	};

	it("reads a calendar from a file path", async () => {
		await givenCalendarFile(SINGLE_EVENT);

		const blocks = await loadBlocks();

		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.name).toBe("Deep Work");
	});

	it("reads a calendar from an http URL", async () => {
		givenCalendarUrl(new Response(SINGLE_EVENT));

		const blocks = await loadBlocks();

		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.name).toBe("Deep Work");
	});

	// Naming a calendar is the deliberate act; the file is the default.
	it("prefers a calendar to a schedule file when both are named", async () => {
		await givenScheduleOf(VALID_SCHEDULE);
		await givenCalendarFile(SINGLE_EVENT);

		const blocks = await loadBlocks();

		expect(blocks.map(({ name }) => name)).toStrictEqual(["Deep Work"]);
	});

	it("falls back to the schedule file when the calendar is set to nothing", async () => {
		await givenScheduleOf(VALID_SCHEDULE);
		vi.stubEnv(FOCUS_CALENDAR_ENV_VAR, "");

		await expect(loadBlocks()).resolves.toHaveLength(2);
	});

	describe("refuses to start", () => {
		it("when the file is missing, naming the variable to set", async () => {
			vi.stubEnv(FOCUS_CALENDAR_ENV_VAR, join(directory, "absent.ics"));

			await expect(loadBlocks()).rejects.toThrow(
				new RegExp(FOCUS_CALENDAR_ENV_VAR, "v"),
			);
		});

		// A calendar and a schedule file are read the same way and configured
		// separately, so the message has to say which one it wanted.
		it("saying it wanted a calendar rather than a schedule", async () => {
			vi.stubEnv(FOCUS_CALENDAR_ENV_VAR, join(directory, "absent.ics"));

			await expect(loadBlocks()).rejects.toThrow(/an iCalendar feed/v);
		});

		it("when the feed is not a calendar", async () => {
			await givenCalendarFile("this is not a calendar");

			await expect(loadBlocks()).rejects.toThrow(/not a valid iCalendar/v);
		});

		// A feed behind a sign-in answers 200 with a page, which would otherwise
		// read as a day with nothing in it.
		it("when the URL answers with something that is not a calendar", async () => {
			givenCalendarUrl(new Response("<html>sign in</html>"));

			await expect(loadBlocks()).rejects.toThrow(/not a valid iCalendar/v);
		});

		it("when the URL answers with an error, saying what it answered", async () => {
			givenCalendarUrl(new Response("nope", { status: 404 }));

			await expect(loadBlocks()).rejects.toThrow(/answered 404/v);
		});

		it("when the URL cannot be reached at all", async () => {
			vi.stubEnv(FOCUS_CALENDAR_ENV_VAR, "https://example.test/basic.ics");
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => await Promise.reject(new Error("offline"))),
			);

			await expect(loadBlocks()).rejects.toThrow(/could not fetch/v);
		});
	});
});
