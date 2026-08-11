import { describe, expect, it } from "vitest";
import { parseCommandLine, usage } from "../cli.ts";

describe("parseCommandLine", () => {
	it("asks for nothing in particular when given nothing", () => {
		expect(parseCommandLine([])).toStrictEqual({
			help: false,
			configPath: undefined,
			programNames: [],
		});
	});

	it("takes a program to run instead of the configured ones", () => {
		expect(parseCommandLine(["focus"]).programNames).toStrictEqual(["focus"]);
	});

	it("takes several, in the order they were named", () => {
		expect(
			parseCommandLine(["focus", "random-emoji"]).programNames,
		).toStrictEqual(["focus", "random-emoji"]);
	});

	it("takes a config file to read instead of the default", () => {
		expect(parseCommandLine(["--config", "other.yml"]).configPath).toBe(
			"other.yml",
		);
	});

	it("takes a config file and a program together", () => {
		const { configPath, programNames } = parseCommandLine([
			"--config",
			"other.yml",
			"focus",
		]);

		expect(configPath).toBe("other.yml");
		expect(programNames).toStrictEqual(["focus"]);
	});

	it.each(["--help", "-h"])("takes %s", (flag) => {
		expect(parseCommandLine([flag]).help).toBe(true);
	});

	// A mistyped flag that was quietly ignored would leave the tool doing
	// something other than what it was told, and looking like it had obeyed.
	it("refuses a flag it does not know, and says where to look", () => {
		expect(() => parseCommandLine(["--programs=focus"])).toThrow(/--help/v);
	});

	it("refuses a config file that was named without a path", () => {
		expect(() => parseCommandLine(["--config"])).toThrow();
	});
});

describe("usage", () => {
	it("lists the programs, since that is what somebody is looking for", () => {
		expect(usage(["focus", "hello-world"], "local/config.yml")).toMatch(
			/focus, hello-world/v,
		);
	});

	it("names the file settings come from", () => {
		expect(usage(["focus"], "local/config.yml")).toMatch(/local\/config\.yml/v);
	});
});
