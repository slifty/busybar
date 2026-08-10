import { HTTP_STATUS } from "@pdc/http-status-codes";
import {
	DRAW_PRIORITY,
	FRONT_DISPLAY_MIDDLE_X,
	FRONT_DISPLAY_MIDDLE_Y,
	FRONT_DISPLAY_WIDTH,
} from "./config.ts";
import type { BusyBar } from "@busy-app/busy-lib";

// busy-lib rejects with a plain Error carrying `status` from the HTTP
// response, so the status has to be read off an unknown value.
const statusOf = (error: unknown): number | undefined => {
	if (error instanceof Error && "status" in error) {
		const { status } = error;

		return typeof status === "number" ? status : undefined;
	}

	return undefined;
};

// The device rejects a draw with 409 when a higher-priority app owns the
// screen -- most commonly an active BUSY or CUSTOM focus session.
const isPreempted = (error: unknown): boolean =>
	statusOf(error) === HTTP_STATUS.CLIENT_ERROR.CONFLICT;

// Removes one application's elements, leaving anything drawn by other
// applications in place.
const clearApplication = async (
	bar: BusyBar,
	applicationName: string,
): Promise<void> => {
	await bar.DisplayClear({ application_name: applicationName });
};

const ERROR_ELEMENT_ID = "error";

// The only red this tool draws, so red on the bar means exactly one thing.
const ERROR_COLOR = "#FF0000FF";
const ERROR_FONT = "small";

// Naming the program rather than the problem is deliberate. There is no
// version of an HTTP error or a parse failure that reads well on 72px of LED,
// and none of it is actionable from across the room -- what the bar is for
// here is telling you to go and look at the terminal, which has the reason in
// full. Program names already match `^[a-zA-Z0-9._-]+$`, so the text cannot be
// rejected for a character the bitmap fonts cannot draw.
const errorText = (programName: string): string => `${programName}: ERROR`;

// Long program names overflow 72px, so the text is given the room to scroll
// rather than being clipped to something unreadable.
const SCROLL_RATE_PX_PER_MINUTE = 600;
const SCROLL_START_DELAY_MS = 1_000;
const SCROLL_REPEAT_DELAY_MS = 2_000;

// A timeout of 0 means the element stays until it is cleared.
//
// Nothing else would do. An error that expired on its own would hand the
// screen back to the clock while the tool was still broken, which is the exact
// impression this is here to prevent -- a bar that looks like it is working.
const NO_TIMEOUT = 0;

// Puts a failure on the bar itself.
//
// Without this, every way of failing looks like the clock: a program between
// blocks, a program that died, and a program retrying a draw it will never
// land are indistinguishable at a glance. Only the first of those is fine.
//
// Drawn under the program's own application name, which is load-bearing in two
// ways. It is the only namespace whose elements the program is guaranteed to
// be able to draw over -- the device hands a tie on priority to whichever
// application already owns the screen, so an error kept anywhere else would be
// what stopped the recovery that clears it. And clearing first means the
// failure replaces the program's last drawing rather than landing on top of
// it, which on 72x16 would leave both unreadable.
//
// The cost is that a failed draw takes down whatever was up, including a
// drawing that was still correct. That is the intended direction: a bar
// showing the last thing that worked is the impression this exists to prevent.
const showError = async (
	bar: BusyBar,
	applicationName: string,
): Promise<void> => {
	await clearApplication(bar, applicationName);

	await bar.DisplayDraw({
		application_name: applicationName,
		priority: DRAW_PRIORITY,
		elements: [
			{
				id: ERROR_ELEMENT_ID,
				type: "text",
				text: errorText(applicationName),
				font: ERROR_FONT,
				color: ERROR_COLOR,
				display: "front",
				align: "center",
				x: FRONT_DISPLAY_MIDDLE_X,
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

export { clearApplication, isPreempted, showError };
