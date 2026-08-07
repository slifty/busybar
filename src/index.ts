// Entry point for the BUSY Bar tool.
//
// Scrolls "Hello, World!" across the front display over USB, and keeps it
// there until interrupted. This is the project's first end-to-end exercise of
// the device: connect, confirm the bar is there, draw, clean up on the way
// out.

import { once } from "node:events";
import { BusyBar } from "@busy-app/busy-lib";
import { DEVICE_ADDRESS } from "./config.ts";
import { clearGreeting, isPreempted, showGreeting } from "./display.ts";

// Node exits as soon as nothing is scheduled, and a registered signal handler
// does not count as scheduled work. Since the greeting is drawn once and then
// left alone, something has to hold the event loop open until we are told to
// stop. The interval length is irrelevant; only its existence matters.
const KEEP_ALIVE_INTERVAL_MS = 60_000;

const log = (message: string): void => {
	process.stdout.write(`busybar: ${message}\n`);
};

const describe = (error: unknown): string =>
	error instanceof Error ? error.message : String(error);

const main = async (): Promise<void> => {
	const bar = new BusyBar({ addr: DEVICE_ADDRESS });

	// Fail loudly and immediately if the bar is not reachable, rather than
	// leaving the process running with nothing on screen.
	const { name } = await bar.SettingsNameGet();

	log(`connected to "${name}" at ${DEVICE_ADDRESS}`);

	try {
		await showGreeting(bar);
		log("showing the greeting -- press Ctrl-C to stop");
	} catch (error) {
		if (isPreempted(error)) {
			log("a higher-priority app owns the screen; nothing was drawn");
		} else {
			throw error;
		}
	}

	const controller = new AbortController();
	const stop = (): void => {
		controller.abort();
	};

	process.once("SIGINT", stop);
	process.once("SIGTERM", stop);

	const keepAlive = setInterval(() => {
		// Deliberately does nothing. See KEEP_ALIVE_INTERVAL_MS above.
	}, KEEP_ALIVE_INTERVAL_MS);

	await once(controller.signal, "abort");
	clearInterval(keepAlive);

	// The greeting has no timeout, so without this it would stay up after we
	// exit.
	try {
		await clearGreeting(bar);
		log("display cleared");
	} catch (error) {
		log(`failed to clear the display: ${describe(error)}`);
	}
};

try {
	await main();
} catch (error) {
	process.stderr.write(`busybar: ${describe(error)}\n`);
	process.exitCode = 1;
}
