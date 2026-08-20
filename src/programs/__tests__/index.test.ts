import { describe, expect, it } from "vitest";
import { programNames, programsToRun, rejectUnknownNames } from "../index.ts";

// The file the run list was read from, which only the program that names it on
// the display cares about.
const CONFIG_FILE = "test-config.yml";

const namesOf = (requested: string[]): string[] =>
	programsToRun(requested, CONFIG_FILE).map(({ name }) => name);

describe("programNames", () => {
	it("lists every program the tool knows", () => {
		expect(programNames()).toContain("hello-world");
		expect(programNames().length).toBeGreaterThan(1);
	});

	// It is what is left when nobody has chosen an operating mode, rather than
	// one somebody would choose, so offering it as an answer would be noise.
	it("does not offer the one that says nothing is set to run", () => {
		expect(programNames()).not.toContain("unconfigured");
	});

	// The list is what an unknown name is answered with, so it is read by
	// somebody looking for the name they should have typed.
	it("is in an order somebody could look a name up in", () => {
		expect(programNames()).toStrictEqual([...programNames()].sort());
	});
});

describe("programsToRun", () => {
	it("resolves one name to one program", () => {
		expect(namesOf(["focus"])).toStrictEqual(["focus"]);
	});

	it("resolves a list to every program in it, in the order asked for", () => {
		expect(namesOf(["random-emoji", "focus"])).toStrictEqual([
			"random-emoji",
			"focus",
		]);
	});

	// A config file with no run list in it is far more often one somebody has
	// yet to fill in than a request for a bar that sits there doing nothing, so
	// the bar is given something to say rather than left to the device's clock.
	it("says nothing is set to run when nothing was asked for", () => {
		expect(namesOf([])).toStrictEqual(["unconfigured"]);
	});

	it("says which name it did not recognise, and what it would have taken", () => {
		expect(() => namesOf(["focus", "nonsense"])).toThrow(/"nonsense"/v);
		expect(() => namesOf(["focus", "nonsense"])).toThrow(/hello-world/v);
	});

	// Starting the two a list got right and then failing on the third would
	// leave the bar half doing what was asked for.
	it("refuses the whole list rather than the part it understood", () => {
		expect(() => namesOf(["focus", "nonsense"])).toThrow();
	});

	// Inherited properties are not programs, however much `PROGRAMS.toString`
	// looks like a lookup that works.
	it("does not resolve something that is not a program", () => {
		expect(() => namesOf(["toString"])).toThrow(/unknown program/v);
	});

	// Nor by the name of the one that is not in the list, which is what is left
	// when nobody has asked for anything rather than something to ask for.
	it("does not resolve the one that says nothing is set to run", () => {
		expect(() => namesOf(["unconfigured"])).toThrow(/unknown program/v);
	});

	// One application name drawn to and cleared by two loops, each undoing the
	// other.
	it("refuses to run the same program twice", () => {
		expect(() => namesOf(["focus", "focus"])).toThrow(/more than once/v);
	});
});

// Settings are kept for a program that is not running, so a block is no longer
// proof that anything read it: a misspelled one has to be refused here or it
// is never refused at all.
describe("rejectUnknownNames", () => {
	it("accepts the names of programs", () => {
		expect(() => {
			rejectUnknownNames(["focus", "event"]);
		}).not.toThrow();
	});

	it("accepts a list with nothing in it", () => {
		expect(() => {
			rejectUnknownNames([]);
		}).not.toThrow();
	});

	it("says which name it did not recognise, and what it would have taken", () => {
		expect(() => {
			rejectUnknownNames(["focos"]);
		}).toThrow(/"focos"/v);
		expect(() => {
			rejectUnknownNames(["focos"]);
		}).toThrow(/hello-world/v);
	});
});
