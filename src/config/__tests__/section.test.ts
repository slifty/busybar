import { describe, expect, it } from "vitest";
import { createSection } from "../section.ts";
import type { ConfigSection } from "../section.ts";

// The file these claim to come from is named for what it is: the messages are
// what this suite is mostly about, and one quoting a real-looking path would
// send somebody looking for a file that does not exist.
const FILE = "test-config.yml";

const rootOf = (value: unknown): ConfigSection =>
	createSection(FILE, "", value);

const sectionOf = (value: unknown): ConfigSection =>
	createSection(FILE, "programs.focus", value);

describe("string", () => {
	it("reads what was written", () => {
		expect(
			sectionOf({ file: "local/focus.json" }).string("file", "fallback"),
		).toBe("local/focus.json");
	});

	it("falls back when the setting is absent", () => {
		expect(sectionOf({}).string("file", "fallback")).toBe("fallback");
	});

	// A key with nothing after it is how YAML writes a line somebody has yet
	// to fill in, and it parses to null rather than to a missing key.
	it.each([
		["nothing after it", null],
		["an empty value", ""],
		["nothing but spaces", "   "],
	])("falls back on a setting with %s", (_label, value) => {
		expect(sectionOf({ file: value }).string("file", "fallback")).toBe(
			"fallback",
		);
	});

	it("trims what was written, since a trailing space is never meant", () => {
		expect(sectionOf({ file: " local/focus.json " }).string("file", "x")).toBe(
			"local/focus.json",
		);
	});

	// An inherited property is not a setting, however much `toString` looks
	// like a key that resolves.
	it("does not read a setting nobody wrote", () => {
		expect(sectionOf({}).string("toString", "fallback")).toBe("fallback");
	});

	it("refuses a value that is not text, naming the setting in full", () => {
		expect(() => sectionOf({ file: 42 }).string("file", "x")).toThrow(
			`${FILE}: programs.focus.file must be text`,
		);
	});
});

describe("optionalString", () => {
	it("is undefined when the setting is absent, which is not the same as empty", () => {
		expect(sectionOf({}).optionalString("calendar")).toBeUndefined();
	});

	it("reads what was written", () => {
		expect(
			sectionOf({ calendar: "https://example.test/basic.ics" }).optionalString(
				"calendar",
			),
		).toBe("https://example.test/basic.ics");
	});
});

describe("section", () => {
	it("reads a block nested inside another", () => {
		const root = rootOf({ device: { address: "10.0.0.1" } });

		expect(root.section("device").string("address", "x")).toBe("10.0.0.1");
	});

	// A program with no block is a program running on its defaults, which is
	// the same thing as one whose block says nothing.
	it("reads an absent block as an empty one", () => {
		expect(rootOf({}).section("device").string("address", "fallback")).toBe(
			"fallback",
		);
	});

	it("refuses a block that is not a block", () => {
		expect(() => rootOf({ device: "10.0.0.1" }).section("device")).toThrow(
			`${FILE}: device must be a block of settings`,
		);
	});

	it("refuses a document that is not a block", () => {
		expect(() => rootOf(["focus"])).toThrow(
			`${FILE}: the file must be a block of settings`,
		);
	});

	// The file being empty is not the file being wrong: everything has a
	// default, so a document with nothing in it is a working configuration.
	it.each([
		["empty", null],
		["absent", undefined],
	])("reads an %s document as one with nothing set", (_label, value) => {
		expect(rootOf(value).string("anything", "fallback")).toBe("fallback");
	});
});

describe("names", () => {
	it("lists what was written, in the order it was written in", () => {
		const programs = sectionOf({ "random-emoji": null, focus: { file: "x" } });

		expect(programs.names()).toStrictEqual(["random-emoji", "focus"]);
	});

	it("is nothing for a block that was never written", () => {
		expect(rootOf({}).section("programs").names()).toStrictEqual([]);
	});
});

describe("where", () => {
	it("says where a setting is written, for a message about fixing it", () => {
		expect(sectionOf({}).where("file")).toBe(`programs.focus.file in ${FILE}`);
	});
});

// A misspelled setting that is quietly ignored is a line in the file that
// plainly says what the bar should do while doing nothing at all.
describe("done", () => {
	it("accepts a block whose every setting was read", () => {
		const section = sectionOf({ calendar: "x", file: "y" });

		section.optionalString("calendar");
		section.string("file", "z");

		expect(() => {
			section.done();
		}).not.toThrow();
	});

	it("refuses a setting nothing asked for", () => {
		const section = sectionOf({ calender: "x" });

		section.optionalString("calendar");

		expect(() => {
			section.done();
		}).toThrow(/no setting called programs\.focus\.calender/v);
	});

	// The answer to a rejected key is almost always the one next to it in the
	// alphabet, so the message carries what the block does take.
	it("lists what the block would have taken", () => {
		const section = sectionOf({ calender: "x" });

		section.optionalString("calendar");
		section.string("file", "y");

		expect(() => {
			section.done();
		}).toThrow(/takes: calendar, file/v);
	});

	it("says so plainly when the block takes nothing at all", () => {
		const section = sectionOf({ anything: "x" });

		expect(() => {
			section.done();
		}).toThrow(/takes no settings/v);
	});

	it("names every setting it did not recognise, not only the first", () => {
		const section = sectionOf({ one: 1, two: 2 });

		expect(() => {
			section.done();
		}).toThrow(/programs\.focus\.one, programs\.focus\.two/v);
	});

	it("counts a nested block as read", () => {
		const root = rootOf({ device: { address: "10.0.0.1" } });

		root.section("device");

		expect(() => {
			root.done();
		}).not.toThrow();
	});

	it("counts every name in a block of names as read", () => {
		const programs = sectionOf({ focus: null });

		programs.names();

		expect(() => {
			programs.done();
		}).not.toThrow();
	});
});
