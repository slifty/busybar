import {
	APPLICATION_NAME,
	DRAW_PRIORITY,
	FRONT_DISPLAY_MIDDLE_Y,
	FRONT_DISPLAY_WIDTH,
	GREETING_COLOR,
	GREETING_FONT,
	GREETING_TEXT,
	SCROLL_RATE_PX_PER_MINUTE,
	SCROLL_REPEAT_DELAY_MS,
	SCROLL_START_DELAY_MS,
} from "./config.ts";
import type { BusyBar } from "@busy-app/busy-lib";

const ELEMENT_ID = "greeting";

// A timeout of 0 means "no timeout": the element stays up until we clear it.
//
// That is not just a convenience. Redrawing an element restarts its scroll
// animation from the beginning, so a program that redrew on a loop would make
// the greeting stutter back to the start on every tick.
const NO_TIMEOUT = 0;

// The device rejects a draw with 409 when a higher-priority app owns the
// screen -- most commonly an active BUSY or CUSTOM focus session.
const HTTP_CONFLICT = 409;

// busy-lib rejects with a plain Error carrying `status` from the HTTP
// response, so the status has to be read off an unknown value.
const statusOf = (error: unknown): number | undefined => {
	if (error instanceof Error && "status" in error) {
		const { status } = error;

		return typeof status === "number" ? status : undefined;
	}

	return undefined;
};

const isPreempted = (error: unknown): boolean =>
	statusOf(error) === HTTP_CONFLICT;

// Draws the greeting across the front display, scrolling because the text is
// wider than the display.
const showGreeting = async (bar: BusyBar): Promise<void> => {
	await bar.DisplayDraw({
		application_name: APPLICATION_NAME,
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

// Removes this app's elements, leaving anything drawn by other apps in place.
const clearGreeting = async (bar: BusyBar): Promise<void> => {
	await bar.DisplayClear({ application_name: APPLICATION_NAME });
};

export { clearGreeting, isPreempted, showGreeting };
