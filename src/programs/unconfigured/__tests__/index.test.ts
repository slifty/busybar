import { describe, expect, it } from "vitest";
import { DEFAULT_DRAW_PRIORITY } from "../../../constants/device.ts";
import { createFakeBar } from "../../../test/bar.ts";
import { sectionOf } from "../../../test/config.ts";
import { unconfigured } from "../index.ts";
import type { ProgramContext } from "../../../program.ts";
import type { FakeBar } from "../../../test/bar.ts";

// Named for what it is rather than for anywhere real, so a message quoted in a
// failing assertion cannot be read as being about somebody's own config file.
const CONFIG_FILE = "test-config.yml";

const contextFor = (fake: FakeBar, said: string[] = []): ProgramContext => ({
	bar: fake.bar,
	config: sectionOf(),
	applicationName: "unconfigured",
	priority: DEFAULT_DRAW_PRIORITY,
	log: (message) => {
		said.push(message);
	},
	redraw: () => undefined,
	releaseScreen: () => undefined,
});

const drawnBy = async (configFile: string): Promise<FakeBar> => {
	const fake = createFakeBar();

	await unconfigured(configFile).draw(contextFor(fake));

	return fake;
};

const linesOf = ({ draws }: FakeBar): string[] =>
	draws.flatMap(({ elements }) =>
		elements.map((element) => ("text" in element ? element.text : "")),
	);

describe("unconfigured", () => {
	it("says that nothing is set to run", async () => {
		const fake = await drawnBy(CONFIG_FILE);

		expect(linesOf(fake).join(" ")).toContain("No programs to run");
	});

	// `--config` means the default is not always the file being read, and the
	// file is the thing to go and open.
	it("names the file the run list would go in", async () => {
		const fake = await drawnBy("other.yml");

		expect(linesOf(fake).join(" ")).toContain("other.yml");
	});

	// A path is one long unbreakable word, so a long one is what the fitting
	// cuts -- and "Edit /Users/som..." names a file nobody has. The log has
	// room for the whole of it.
	it("says what kind of file it is when the path will not fit", async () => {
		const fake = await drawnBy("/Users/somebody/elsewhere/other-config.yml");
		const drawn = linesOf(fake).join(" ");

		expect(drawn).toBe("No programs to run. Edit the config file");
		expect(drawn).not.toContain("...");
	});

	// The message is fitted rather than scrolled, so it arrives as lines.
	it("draws it as text that stands still", async () => {
		const fake = await drawnBy(CONFIG_FILE);
		const {
			draws: [draw],
		} = fake;

		expect(fake.draws).toHaveLength(1);
		expect(draw?.elements.length).toBeGreaterThan(0);

		for (const element of draw?.elements ?? []) {
			expect(element).toMatchObject({ type: "text", timeout: 0 });
			expect(element).not.toHaveProperty("scroll_rate");
		}
	});

	// Nothing about it changes, and an element with no timeout is one the
	// device sustains on its own.
	it("does not ask to be drawn again", async () => {
		const fake = createFakeBar();

		const result = await unconfigured(CONFIG_FILE).draw(contextFor(fake));

		expect(result).toStrictEqual({});
	});

	// The bar has room for the file and the instruction. The log has room for
	// the name of the list as well, which is the thing to go and write.
	it("says in the log which list to add a program to", async () => {
		const fake = createFakeBar();
		const said: string[] = [];

		await unconfigured(CONFIG_FILE).start?.(contextFor(fake, said));

		expect(said.join(" ")).toContain("run list");
		expect(said.join(" ")).toContain(CONFIG_FILE);
	});
});
