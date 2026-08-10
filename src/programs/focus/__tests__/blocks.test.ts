import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { FOCUS_FILE_ENV_VAR, drawableName, loadBlocks } from "../blocks.ts";
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
