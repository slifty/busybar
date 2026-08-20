import {
	FRONT_DISPLAY_HEIGHT,
	FRONT_DISPLAY_MIDDLE_X,
	FRONT_DISPLAY_WIDTH,
} from "../../constants/device.ts";
import { fitText } from "../../text.ts";
import type { DrawResult, Program, ProgramContext } from "../../program.ts";

const ELEMENT_ID = "unconfigured";

// White, because red is the colour of a failure and this is not one. Nothing
// is broken: the tool ran, reached the bar, and found that nobody has said
// what it should do.
const MESSAGE_COLOR = "#FFFFFFFF";

// A timeout of 0 means the element stays until it is cleared. Anything else
// would hand the screen back to the device's clock, which is precisely the
// look this program exists to replace.
const NO_TIMEOUT = 0;

const REGION = {
	width: FRONT_DISPLAY_WIDTH,
	height: FRONT_DISPLAY_HEIGHT,
};

// The state, then what to do about it, because the wrap falls between them:
// "No programs to run." on one line and "Edit local/config.yml" on the next,
// at a size you can read from a desk away.
const PROBLEM = "No programs to run.";

// What to edit when the file cannot be named on 72 pixels.
const UNNAMED_FILE = "the config file";

// Whether a message survives being fitted to the display whole.
//
// The fitting cuts what cannot be made to fit at any size, and the end of this
// message is the part worth keeping -- so a message that would be cut is not
// shortened, it is replaced.
const survives = (text: string): boolean =>
	fitText(text, REGION)
		.lines.map(({ text: line }) => line)
		.join(" ") === text;

// The message, naming the file when there is room to name it.
//
// The file is worth naming: it is the thing to go and open, and `--config`
// means the default is not always the file being read. It is also the part
// that will not fit, since a path is one long unbreakable word and the display
// holds about eighteen characters of it. A path cut to "Edit /Users/som..."
// names a file nobody has while spending the line that could have said which
// kind of file it was, so a path that does not fit is left to the log, which
// has room for the whole of it.
const messageFor = (configFile: string): string => {
	const named = `${PROBLEM} Edit ${configFile}`;

	return survives(named) ? named : `${PROBLEM} Edit ${UNNAMED_FILE}`;
};

// What the bar shows when nothing has been set to run.
//
// The alternative is the device's own clock, which is what the bar shows when
// this tool is not running at all -- so a first run with no config file would
// look exactly like a run that never happened, and the greeting that used to
// be here looked exactly like a tool with nothing more to offer. Neither says
// the one thing worth saying, which is that the tool is waiting to be told
// what to do.
//
// It is not in the list of programs, and cannot be asked for by name: it is
// not an operating mode somebody would choose, it is what is left when nobody
// has chosen one. Taking the file it names as an argument is what keeps it
// honest about which file that is.
const unconfigured = (configFile: string): Program => {
	const message = messageFor(configFile);

	const draw = async ({
		bar,
		applicationName,
		priority,
	}: ProgramContext): Promise<DrawResult> => {
		const fitted = fitText(message, REGION);

		await bar.DisplayDraw({
			application_name: applicationName,
			priority,
			elements: fitted.lines.map(({ text, y }, index) => ({
				id: `${ELEMENT_ID}-${String(index)}`,
				type: "text" as const,
				text,
				font: fitted.font,
				color: MESSAGE_COLOR,
				display: "front" as const,
				align: "top_mid" as const,
				x: FRONT_DISPLAY_MIDDLE_X,
				y,
				timeout: NO_TIMEOUT,
			})),
		});

		// Nothing about the message changes, and the device holds still text
		// on its own, so there is no reason to come back. Adding a program to
		// the file is a restart.
		return {};
	};

	return {
		name: "unconfigured",
		description: "Says that nothing has been set to run",
		start: async ({ log }: ProgramContext): Promise<void> => {
			// The bar has room for the file and the instruction; the log has
			// room for the whole of it, including the name of the list.
			log(`add a program to the run list in ${configFile}`);

			await Promise.resolve();
		},
		draw,
	};
};

export { unconfigured };
