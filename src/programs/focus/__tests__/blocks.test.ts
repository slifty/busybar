import { mkdtempSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
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
import { TEST_CONFIG_FILE, sectionOf } from "../../../test/config.ts";
import { loadBlocks, mirrorBlocks } from "../blocks.ts";
import { DEFAULT_FOCUS_FILE, focusSettings } from "../settings.ts";
import { SINGLE_EVENT } from "./fixtures/calendars.ts";
import { VALID_SCHEDULE } from "./fixtures/valid-schedule.ts";
import type { Focus } from "../focus.ts";
import type { FocusSettings } from "../settings.ts";

// The loader is given a real file in a temporary directory rather than a mocked
// `fs`. Reading a file is the whole job, so faking it would leave the part
// worth testing untested -- and the error messages a mistyped schedule produces
// are exactly what this needs to pin down.
const directory = mkdtempSync(join(tmpdir(), "busybar-focus-"));

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

// What the program has been configured with, built up by the `given...`
// helpers below and handed to the loader by `load`.
let written: Record<string, unknown> = {};

beforeEach(() => {
	written = {};
});

const configure = (values: Record<string, unknown>): void => {
	written = { ...written, ...values };
};

const settings = (): FocusSettings => focusSettings(sectionOf(written));

const load = async (): Promise<Focus[]> => await loadBlocks(settings());

// Writes a schedule file and points the loader at it, returning nothing so that
// each test reads as "given this file, expect this".
const givenSchedule = async (contents: string): Promise<void> => {
	const path = join(directory, `${String(Math.random()).slice(2)}.json`);

	await writeFile(path, contents, "utf8");
	configure({ file: path });
};

const givenScheduleOf = async (blocks: unknown): Promise<void> => {
	await givenSchedule(JSON.stringify(blocks));
};

describe("loadBlocks", () => {
	it("reads a whole schedule", async () => {
		await givenScheduleOf(VALID_SCHEDULE);

		const blocks = await load();

		expect(blocks).toHaveLength(2);
		expect(blocks[0]?.name).toBe("Deep Work");
		expect(blocks[0]?.start).toStrictEqual(new Date("2026-01-01T09:00:00Z"));
		expect(blocks[0]?.end).toStrictEqual(new Date("2026-01-01T10:30:00Z"));
	});

	it("sanitises names on the way in, so nothing undrawable reaches the device", async () => {
		await givenScheduleOf(VALID_SCHEDULE);

		const blocks = await load();

		expect(blocks[1]?.name).toBe("Focus: Q3 Roadmap");
	});

	it("accepts an empty schedule", async () => {
		await givenScheduleOf([]);

		await expect(load()).resolves.toStrictEqual([]);
	});

	// The default is what you get by configuring nothing at all, so it is worth
	// pinning down that it is the path actually read.
	it("falls back to the default file when no path is named", async () => {
		const cwd = process.cwd();

		// Somewhere without a `local/`, so the default resolves to something
		// absent rather than to whatever this checkout happens to be carrying.
		process.chdir(directory);

		try {
			await expect(load()).rejects.toThrow(DEFAULT_FOCUS_FILE);
		} finally {
			process.chdir(cwd);
		}
	});

	it("keeps blocks in the order they were written, overlaps and all", async () => {
		await givenScheduleOf([
			{ name: "b", start: "2026-01-01T11:00:00Z", end: "2026-01-01T12:00:00Z" },
			{ name: "a", start: "2026-01-01T09:00:00Z", end: "2026-01-01T10:00:00Z" },
		]);

		const blocks = await load();

		expect(blocks.map(({ name }) => name)).toStrictEqual(["b", "a"]);
	});

	describe("refuses to start", () => {
		beforeEach(() => {
			configure({ file: join(directory, "absent.json") });
		});

		it("when the file is missing", async () => {
			await expect(load()).rejects.toThrow(/could not read/v);
		});

		it("naming the setting to fix, and the file it is written in", async () => {
			await expect(load()).rejects.toThrow(
				new RegExp(`file in ${TEST_CONFIG_FILE}`, "v"),
			);
		});

		it("keeping the underlying failure as the error's cause", async () => {
			const error = await load().catch((reason: unknown) => reason);

			expect(error).toBeInstanceOf(Error);
			expect(error instanceof Error && error.cause !== undefined).toBe(true);
		});
	});

	describe("refuses a schedule it cannot make sense of", () => {
		it("when the file is not JSON", async () => {
			await givenSchedule("{ not json");

			await expect(load()).rejects.toThrow(/is not valid JSON/v);
		});

		it("when the document is not an array", async () => {
			await givenScheduleOf({ name: "Deep Work" });

			await expect(load()).rejects.toThrow(/must hold an array/v);
		});

		it("when a block is not an object", async () => {
			await givenScheduleOf(["Deep Work"]);

			await expect(load()).rejects.toThrow(/expected an object/v);
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

			await expect(load()).rejects.toThrow(
				new RegExp(`"${field}" must be a string`, "v"),
			);
		});

		it("when a date cannot be parsed", async () => {
			await givenScheduleOf([
				{ name: "Deep Work", start: "never", end: "2026-01-01T10:00:00Z" },
			]);

			await expect(load()).rejects.toThrow(/"start" is not a date/v);
		});

		it("when a block ends before it starts", async () => {
			await givenScheduleOf([
				{
					name: "Deep Work",
					start: "2026-01-01T10:00:00Z",
					end: "2026-01-01T09:00:00Z",
				},
			]);

			await expect(load()).rejects.toThrow(/"end" must be after "start"/v);
		});

		it("when a block ends exactly when it starts", async () => {
			await givenScheduleOf([
				{
					name: "Deep Work",
					start: "2026-01-01T09:00:00Z",
					end: "2026-01-01T09:00:00Z",
				},
			]);

			await expect(load()).rejects.toThrow(/"end" must be after "start"/v);
		});

		it("when a name has nothing the display can render", async () => {
			await givenScheduleOf([
				{
					name: "🎯🔥",
					start: "2026-01-01T09:00:00Z",
					end: "2026-01-01T10:00:00Z",
				},
			]);

			await expect(load()).rejects.toThrow(/nothing the display can render/v);
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

			await expect(load()).rejects.toThrow(/block 2/v);
		});
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
		configure({ calendar: path });
	};

	// Only the response is faked. What is being pinned down is which of the two
	// ways of reading a calendar gets used, and what happens to what comes back.
	const givenCalendarUrl = (response: Response): void => {
		configure({ calendar: "https://example.test/basic.ics" });
		vi.stubGlobal(
			"fetch",
			vi.fn(async () => await Promise.resolve(response)),
		);
	};

	it("reads a calendar from a file path", async () => {
		await givenCalendarFile(SINGLE_EVENT);

		const blocks = await load();

		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.name).toBe("Deep Work");
	});

	it("reads a calendar from an http URL", async () => {
		givenCalendarUrl(new Response(SINGLE_EVENT));

		const blocks = await load();

		expect(blocks).toHaveLength(1);
		expect(blocks[0]?.name).toBe("Deep Work");
	});

	// Naming a calendar is the deliberate act; the file is the default.
	it("prefers a calendar to a schedule file when both are named", async () => {
		await givenScheduleOf(VALID_SCHEDULE);
		await givenCalendarFile(SINGLE_EVENT);

		const blocks = await load();

		expect(blocks.map(({ name }) => name)).toStrictEqual(["Deep Work"]);
	});

	// A setting left blank is a line somebody meant to fill in, not a request
	// for an empty calendar.
	it("falls back to the schedule file when the calendar is left blank", async () => {
		await givenScheduleOf(VALID_SCHEDULE);
		configure({ calendar: "" });

		await expect(load()).resolves.toHaveLength(2);
	});

	describe("refuses to start", () => {
		it("when the file is missing, naming the setting to fix", async () => {
			configure({ calendar: join(directory, "absent.ics") });

			await expect(load()).rejects.toThrow(
				new RegExp(`calendar in ${TEST_CONFIG_FILE}`, "v"),
			);
		});

		// A calendar and a schedule file are read the same way and configured
		// separately, so the message has to say which one it wanted.
		it("saying it wanted a calendar rather than a schedule", async () => {
			configure({ calendar: join(directory, "absent.ics") });

			await expect(load()).rejects.toThrow(/an iCalendar feed/v);
		});

		it("when the feed is not a calendar", async () => {
			await givenCalendarFile("this is not a calendar");

			await expect(load()).rejects.toThrow(/not a valid iCalendar/v);
		});

		// A feed behind a sign-in answers 200 with a page, which would otherwise
		// read as a day with nothing in it.
		it("when the URL answers with something that is not a calendar", async () => {
			givenCalendarUrl(new Response("<html>sign in</html>"));

			await expect(load()).rejects.toThrow(/not a valid iCalendar/v);
		});

		it("when the URL answers with an error, saying what it answered", async () => {
			givenCalendarUrl(new Response("nope", { status: 404 }));

			await expect(load()).rejects.toThrow(/answered 404/v);
		});

		it("when the URL cannot be reached at all", async () => {
			configure({ calendar: "https://example.test/basic.ics" });
			vi.stubGlobal(
				"fetch",
				vi.fn(async () => await Promise.reject(new Error("offline"))),
			);

			await expect(load()).rejects.toThrow(/could not fetch/v);
		});
	});

	// The file is not read while a calendar is set, so what this is for is the
	// person who opens it: a schedule file saying something the bar has not
	// shown for weeks is the first thing anyone would check.
	describe("mirroring a calendar into the schedule file", () => {
		const said = vi.fn<(message: string) => void>();

		const jsonAt = async (path: string): Promise<unknown> =>
			JSON.parse(await readFile(path, "utf8"));

		const givenScheduleFileAt = (): string => {
			const path = join(directory, `${String(Math.random()).slice(2)}.json`);

			configure({ file: path });

			return path;
		};

		const mirror = async (
			blocks: readonly Focus[],
			log: (message: string) => void = said,
		): Promise<void> => {
			await mirrorBlocks(settings(), blocks, log);
		};

		it("writes what the calendar said", async () => {
			const path = givenScheduleFileAt();

			await givenCalendarFile(SINGLE_EVENT);
			await mirror(await load());

			expect(await jsonAt(path)).toStrictEqual([
				{
					name: "Deep Work",
					start: "2026-01-02T09:00:00.000Z",
					end: "2026-01-02T10:30:00.000Z",
				},
			]);
		});

		// Which is the point: taking the calendar back out afterwards leaves a
		// working schedule rather than whatever was there before.
		it("writes a file the loader can read back", async () => {
			const path = givenScheduleFileAt();

			await givenCalendarFile(SINGLE_EVENT);

			const fromCalendar = await load();

			await mirror(fromCalendar);
			configure({ calendar: undefined, file: path });

			await expect(load()).resolves.toStrictEqual(fromCalendar);
		});

		// Rewriting it from itself could only lose something -- the ordering,
		// the whitespace, a comment someone left in a JSON5 moment.
		it("leaves the file alone when there is no calendar", async () => {
			const path = givenScheduleFileAt();

			await writeFile(path, "the file as it was", "utf8");

			await mirror([]);

			expect(await readFile(path, "utf8")).toBe("the file as it was");
		});

		// The tool reads the calendar directly and works without ever writing
		// this, so a directory it cannot write to is not a reason to refuse to
		// run -- only a reason to say so.
		it("reports a write it could not make rather than failing", async () => {
			const log = vi.fn<(message: string) => void>();

			configure({ file: join(directory, "no", "such", "dir.json") });
			await givenCalendarFile(SINGLE_EVENT);

			await expect(mirror(await load(), log)).resolves.toBeUndefined();

			expect(log).toHaveBeenCalledWith(expect.stringMatching(/dir\.json/v));
		});

		// A schedule half-written by a process that died is not a schedule.
		it("leaves nothing behind if it cannot finish", async () => {
			const path = givenScheduleFileAt();

			await givenCalendarFile(SINGLE_EVENT);
			await mirror(await load());

			await expect(readFile(`${path}.writing`, "utf8")).rejects.toThrow();
		});
	});
});
