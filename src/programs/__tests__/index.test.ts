import { describe, expect, it } from "vitest";
import {
	DEFAULT_PROGRAM_NAME,
	programNames,
	resolvePrograms,
} from "../index.ts";

const namesOf = (requested: string | undefined): string[] =>
	resolvePrograms(requested).map(({ name }) => name);

describe("programNames", () => {
	it("lists every program the tool knows", () => {
		expect(programNames()).toContain(DEFAULT_PROGRAM_NAME);
		expect(programNames().length).toBeGreaterThan(1);
	});

	// The list is what an unknown name is answered with, so it is read by
	// somebody looking for the name they should have typed.
	it("is in an order somebody could look a name up in", () => {
		expect(programNames()).toStrictEqual([...programNames()].sort());
	});
});

describe("resolvePrograms", () => {
	it("resolves one name to one program", () => {
		expect(namesOf("focus")).toStrictEqual(["focus"]);
	});

	it("resolves a list to every program in it, in the order asked for", () => {
		expect(namesOf("random-emoji,focus")).toStrictEqual([
			"random-emoji",
			"focus",
		]);
	});

	// A list is a thing people write by hand, in a `.env`, with spaces.
	it("tolerates whitespace around the names", () => {
		expect(namesOf(" focus , random-emoji ")).toStrictEqual([
			"focus",
			"random-emoji",
		]);
	});

	// A variable left empty in a `.env` is far more often a line someone meant
	// to fill in than a request to run nothing at all.
	it.each([
		["unset", undefined],
		["empty", ""],
		["nothing but separators", " , , "],
	])("runs the default program when the variable is %s", (_label, value) => {
		expect(namesOf(value)).toStrictEqual([DEFAULT_PROGRAM_NAME]);
	});

	it("says which name it did not recognise, and what it would have taken", () => {
		expect(() => resolvePrograms("focus,nonsense")).toThrow(/"nonsense"/v);
		expect(() => resolvePrograms("focus,nonsense")).toThrow(
			new RegExp(DEFAULT_PROGRAM_NAME, "v"),
		);
	});

	// Starting the two a list got right and then failing on the third would
	// leave the bar half doing what was asked for.
	it("refuses the whole list rather than the part it understood", () => {
		expect(() => resolvePrograms("focus,nonsense")).toThrow();
	});

	// Inherited properties are not programs, however much `PROGRAMS.toString`
	// looks like a lookup that works.
	it("does not resolve something that is not a program", () => {
		expect(() => resolvePrograms("toString")).toThrow(/unknown program/v);
	});

	// One application name drawn to and cleared by two loops, each undoing the
	// other.
	it("refuses to run the same program twice", () => {
		expect(() => resolvePrograms("focus,focus")).toThrow(/more than once/v);
	});
});
