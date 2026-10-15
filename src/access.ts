// What to say when the bar will not talk to the tool.
//
// Over USB the bar answers anything. Over the network it answers nothing until
// it is told to -- HTTP access is off out of the box -- and then, in its `key`
// mode, only what carries the key. Either way the refusal is a bare 403 with
// "Forbidden" in it, which names neither the setting on the bar nor the one in
// the file, and it arrives before anything has been drawn: a refused tool
// cannot put its own failure on the display, so the line it exits with is the
// only place the reason can go.

import { HTTP_STATUS } from "@pdc/http-status-codes";
import { statusOf } from "./display.ts";
import type { Config } from "./config/index.ts";

// The device answers 403 for a missing key and for a wrong one. 401 is what
// the same refusal would more properly be, and costs nothing to recognise.
const isRefused = (error: unknown): boolean => {
	const status = statusOf(error);

	return (
		status === HTTP_STATUS.CLIENT_ERROR.FORBIDDEN ||
		status === HTTP_STATUS.CLIENT_ERROR.UNAUTHORIZED
	);
};

// A refusal, with the reason put where somebody can act on it.
//
// Which of the two things to say depends on whether a password was sent, and
// neither is certain: the bar does not say whether it wanted a key it was not
// given or was not taking requests from the network at all. So each names
// both ends -- the setting in the file and the one on the bar.
const explainRefusal = (
	error: unknown,
	{ deviceAddress, devicePassword, path }: Config,
): Error => {
	const reason =
		devicePassword === undefined
			? `it answers over USB without one, but over the network it wants the key it was given when HTTP access was turned on -- set device.password in ${path}`
			: `device.password in ${path} is not the key it was given, or HTTP access is turned off on the bar`;

	return new Error(`the bar at ${deviceAddress} refused access: ${reason}`, {
		cause: error,
	});
};

export { explainRefusal, isRefused };
