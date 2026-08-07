import {
	DRAW_PRIORITY,
	FRONT_DISPLAY_MIDDLE_Y,
	FRONT_DISPLAY_WIDTH,
} from "../../config.ts";
import type { Program, ProgramContext } from "../../program.ts";

const ELEMENT_ID = "greeting";

const GREETING_TEXT = "Hello, World!";

// `extra_large` is wide enough that the greeting overflows 72px, which is what
// makes it scroll. It is also an uppercase-only face, so the text renders as
// "HELLO, WORLD!" regardless of how it is written here.
const GREETING_FONT = "extra_large";
const GREETING_COLOR = "#33CCFFFF";

// Scroll rate is pixels per minute, not per second.
const SCROLL_RATE_PX_PER_MINUTE = 1_200;
const SCROLL_START_DELAY_MS = 1_000;
const SCROLL_REPEAT_DELAY_MS = 2_000;

// A timeout of 0 means "no timeout": the element stays up until it is cleared.
//
// That is not just a convenience. Redrawing an element restarts its scroll
// animation from the beginning, so refreshing on a schedule would make the
// greeting stutter back to the start on every tick. Hence no
// `refreshIntervalMs` below either.
const NO_TIMEOUT = 0;

const draw = async ({
	bar,
	applicationName,
}: ProgramContext): Promise<void> => {
	await bar.DisplayDraw({
		application_name: applicationName,
		priority: DRAW_PRIORITY,
		elements: [
			{
				id: ELEMENT_ID,
				type: "text",
				text: GREETING_TEXT,
				font: GREETING_FONT,
				color: GREETING_COLOR,
				display: "front",
				align: "mid_left",
				x: 0,
				y: FRONT_DISPLAY_MIDDLE_Y,
				width: FRONT_DISPLAY_WIDTH,
				scroll_rate: SCROLL_RATE_PX_PER_MINUTE,
				scroll_start_delay: SCROLL_START_DELAY_MS,
				scroll_repeat_delay: SCROLL_REPEAT_DELAY_MS,
				timeout: NO_TIMEOUT,
			},
		],
	});
};

const helloWorld: Program = {
	name: "hello-world",
	description: 'Scrolls "Hello, World!" across the front display',
	draw,
};

export { helloWorld };
