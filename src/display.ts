import { HTTP_STATUS } from "@pdc/http-status-codes";
import {
	FRONT_DISPLAY_HEIGHT,
	FRONT_DISPLAY_MIDDLE_X,
	FRONT_DISPLAY_WIDTH,
} from "./config.ts";
import { fitText } from "./text.ts";
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

// Naming the program rather than the problem is deliberate. There is no
// version of an HTTP error or a parse failure that reads well on 72px of LED,
// and none of it is actionable from across the room -- what the bar is for
// here is telling you to go and look at the terminal, which has the reason in
// full. Program names already match `^[a-zA-Z0-9._-]+$`, so the text cannot be
// rejected for a character the bitmap fonts cannot draw.
const errorText = (programName: string): string => `${programName}: ERROR`;

// A long program name is sized down and broken across lines rather than set
// scrolling. A failure is a thing to take in at a glance from across the room,
// and scrolling text is a thing you have to stand and wait for.
const ERROR_REGION = {
	width: FRONT_DISPLAY_WIDTH,
	height: FRONT_DISPLAY_HEIGHT,
};

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
//
// Drawn at the failing program's own priority rather than the default one, so
// that a program which outranks the others is reported as loudly as it speaks:
// at the default, a failure of the program that interrupts everything else
// would be the one failure invisible behind them.
const showError = async (
	bar: BusyBar,
	applicationName: string,
	priority: number,
): Promise<void> => {
	await clearApplication(bar, applicationName);

	const fitted = fitText(errorText(applicationName), ERROR_REGION);

	// One element per line, and no need to account for lines a previous error
	// had and this one does not: the clear above has already taken them down.
	await bar.DisplayDraw({
		application_name: applicationName,
		priority,
		elements: fitted.lines.map(({ text, y }, index) => ({
			id: `${ERROR_ELEMENT_ID}-${String(index)}`,
			type: "text" as const,
			text,
			font: fitted.font,
			color: ERROR_COLOR,
			display: "front" as const,
			align: "top_mid" as const,
			x: FRONT_DISPLAY_MIDDLE_X,
			y,
			timeout: NO_TIMEOUT,
		})),
	});
};

export { clearApplication, isPreempted, showError };
