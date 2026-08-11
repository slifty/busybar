import {
	FRONT_DISPLAY_MIDDLE_X,
	FRONT_DISPLAY_MIDDLE_Y,
} from "../../constants/device.ts";
import { MS_PER_SECOND } from "../../constants/time.ts";
import { randomEmojiName, stockPathFor } from "./emoji.ts";
import type { DrawResult, Program, ProgramContext } from "../../program.ts";

// A stable element id. Redrawing the same id replaces what is on screen
// instead of stacking a second sprite on top of the first.
const ELEMENT_ID = "emoji";

// How often a new emoji is chosen.
const REFRESH_INTERVAL_MS = 5_000;

// How long the device keeps the sprite up without being told again.
//
// Deliberately longer than the refresh interval: if one draw fails, the
// previous emoji stays up until the next attempt rather than the screen
// blanking. Two intervals buys exactly one free retry.
const REFRESHES_PER_TIMEOUT = 2;
const ELEMENT_TIMEOUT_SECONDS =
	(REFRESH_INTERVAL_MS / MS_PER_SECOND) * REFRESHES_PER_TIMEOUT;

const draw = async ({
	bar,
	applicationName,
	priority,
}: ProgramContext): Promise<DrawResult> => {
	await bar.DisplayDraw({
		application_name: applicationName,
		priority,
		elements: [
			{
				id: ELEMENT_ID,
				type: "image",
				stock_path: stockPathFor(randomEmojiName()),
				display: "front",
				align: "center",
				x: FRONT_DISPLAY_MIDDLE_X,
				y: FRONT_DISPLAY_MIDDLE_Y,
				timeout: ELEMENT_TIMEOUT_SECONDS,
				// Required by the generated types even though the API defaults
				// it -- openapi-typescript treats documented defaults as
				// present rather than optional.
				opacity: 100,
			},
		],
	});

	return { nextDrawInMs: REFRESH_INTERVAL_MS };
};

const randomEmoji: Program = {
	name: "random-emoji",
	description: "Shows a random emoji, changing every few seconds",
	draw,
};

export { randomEmoji };
