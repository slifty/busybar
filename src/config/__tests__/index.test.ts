import { mkdtempSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_DEVICE_ADDRESS } from "../../constants/device.ts";
import { DEFAULT_CONFIG_FILE, loadConfig } from "../index.ts";

// A real file in a temporary directory rather than a mocked `fs`. Reading and
// validating a file is the whole job here, so faking it away would leave the
// part worth testing untested -- and it lets this pin down the exact message a
// mistyped setting produces.
const directory = mkdtempSync(join(tmpdir(), "busybar-config-"));

afterAll(async () => {
	await rm(directory, { recursive: true, force: true });
});

const givenConfig = async (contents: string): Promise<string> => {
	const path = join(directory, `${String(Math.random()).slice(2)}.yml`);

	await writeFile(path, contents, "utf8");

	return path;
};

const loadYaml = async (contents: string) =>
	await loadConfig(await givenConfig(contents));

describe("loadConfig", () => {
	it("reads the address of the bar", async () => {
		const config = await loadYaml("device:\n  address: 10.0.0.1\n");

		expect(config.deviceAddress).toBe("10.0.0.1");
	});

	it("falls back to the address a bar ships with", async () => {
		const config = await loadYaml("programs:\n  focus:\n");

		expect(config.deviceAddress).toBe(DEFAULT_DEVICE_ADDRESS);
	});

	// The order is the order they were written in, because that is the order
	// somebody reading the file would expect them to be started in.
	it("lists the programs to run, in the order they were written", async () => {
		const config = await loadYaml("programs:\n  random-emoji:\n  focus:\n");

		expect(config.programNames).toStrictEqual(["random-emoji", "focus"]);
	});

	it("hands each program its own block", async () => {
		const config = await loadYaml(
			"programs:\n  focus:\n    file: local/somewhere.json\n",
		);

		expect(config.forProgram("focus").string("file", "fallback")).toBe(
			"local/somewhere.json",
		);
	});

	// Naming a program on the command line without configuring it runs it on
	// its defaults rather than failing to find its block.
	it("hands a program with no block an empty one", async () => {
		const config = await loadYaml("programs:\n  focus:\n");

		expect(config.forProgram("hello-world").string("x", "fallback")).toBe(
			"fallback",
		);
	});

	it("says which file it read, and that it found it", async () => {
		const path = await givenConfig("programs:\n  focus:\n");
		const config = await loadConfig(path);

		expect(config).toMatchObject({ path, found: true });
	});

	// Running with no config file at all is how the tool works out of the box.
	//
	// Run from the temporary directory rather than from the checkout, which has
	// a `local/config.yml` in it as soon as anybody has configured anything. A
	// suite that passed or failed depending on whether the person running it
	// uses the tool would be worse than no suite at all.
	describe("with no file", () => {
		const cwd = process.cwd();

		beforeEach(() => {
			process.chdir(directory);
		});

		afterEach(() => {
			process.chdir(cwd);
		});

		it("reports the default path, unfound", async () => {
			const config = await loadConfig();

			expect(config).toMatchObject({
				path: DEFAULT_CONFIG_FILE,
				found: false,
			});
		});

		it("runs on defaults rather than failing", async () => {
			const config = await loadConfig();

			expect(config.deviceAddress).toBe(DEFAULT_DEVICE_ADDRESS);
			expect(config.programNames).toStrictEqual([]);
		});
	});

	describe("refuses to start", () => {
		// `--config` is a deliberate act, so quietly running the defaults
		// instead would answer a question nobody asked.
		it("when a file it was pointed at is not there", async () => {
			await expect(loadConfig(join(directory, "absent.yml"))).rejects.toThrow(
				/could not read/v,
			);
		});

		it("keeping the underlying failure as the error's cause", async () => {
			const error = await loadConfig(join(directory, "absent.yml")).catch(
				(reason: unknown) => reason,
			);

			expect(error).toBeInstanceOf(Error);
			expect(error instanceof Error && error.cause !== undefined).toBe(true);
		});

		it("when the file is not YAML", async () => {
			await expect(loadYaml("programs:\n\tfocus: [\n")).rejects.toThrow(
				/is not valid YAML/v,
			);
		});

		it("when the document is not a block of settings", async () => {
			await expect(loadYaml("- focus\n")).rejects.toThrow(
				/must be a block of settings/v,
			);
		});

		it("when a top-level setting is not one", async () => {
			await expect(loadYaml("programm: focus\n")).rejects.toThrow(
				/no setting called programm/v,
			);
		});

		it("when a setting about the bar is not one", async () => {
			await expect(loadYaml("device:\n  addres: 10.0.0.1\n")).rejects.toThrow(
				/no setting called device\.addres/v,
			);
		});

		it("when the address is not text", async () => {
			await expect(loadYaml("device:\n  address: 10\n")).rejects.toThrow(
				/device\.address must be text/v,
			);
		});
	});
});
