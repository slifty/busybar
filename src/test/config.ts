import { createSection } from "../config/section.ts";
import { DEFAULT_DEVICE_ADDRESS } from "../constants/device.ts";
import type { Config } from "../config/index.ts";
import type { ConfigSection } from "../config/section.ts";

// Settings for a suite that needs some, without a file to read them from.
//
// The file these claim to come from is named for what it is, so that an error
// message quoted in a failing assertion cannot be mistaken for one about a
// real config file somebody has on disk.
const TEST_CONFIG_FILE = "test-config.yml";
const TEST_SECTION_PATH = "programs.test-program";

// A block of settings, built from a literal rather than parsed.
const sectionOf = (values: Record<string, unknown> = {}): ConfigSection =>
	createSection(TEST_CONFIG_FILE, TEST_SECTION_PATH, values);

// A whole configuration, where what matters is which block each program gets.
const configOf = (
	programs: Record<string, Record<string, unknown>> = {},
): Config => ({
	path: TEST_CONFIG_FILE,
	found: true,
	deviceAddress: DEFAULT_DEVICE_ADDRESS,
	programNames: Object.keys(programs),
	forProgram: (name) =>
		createSection(TEST_CONFIG_FILE, `programs.${name}`, programs[name]),
});

export { TEST_CONFIG_FILE, TEST_SECTION_PATH, configOf, sectionOf };
