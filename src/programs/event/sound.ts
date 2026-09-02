import { isNotHappening } from "../../display.ts";
import { describe } from "../../errors.ts";
import type { BusyBar } from "@busy-app/busy-lib";

// The noise an alert makes, and how it stops.

// The firmware's own calendar chime, which ships on the device.
//
// `/ext/apps_assets/shared/sounds` holds three sounds, and this is the one the
// bar itself plays when an appointment is starting -- so it is already the
// sound this user's bar means "you have a meeting" with, and nothing this tool
// uploaded would be more recognisable than that. `stock_path` names it
// directly and skips asset upload entirely, the same way `shared/<file>.image`
// does for the built-in sprites.
const ALERT_SOUND = "shared/calendar_event_starts.snd";

// Plays the chime once.
const playAlert = async (
	bar: BusyBar,
	applicationName: string,
): Promise<void> => {
	await bar.AudioPlay({
		application_name: applicationName,
		stock_path: ALERT_SOUND,
	});
};

// Stops whatever the bar is playing.
//
// There is no way to ask for only our own sound to stop: `DELETE
// /api/audio/play` takes no application name, and the device plays one thing
// at a time. Nothing else this tool does makes a noise, so in practice the
// only thing this can silence is the alert it was called about.
//
// Nothing playing is not a failure, and is the ordinary case. The chimes are
// ten seconds apart and under two seconds long, so most of an alert's life is
// silence -- a press lands between two chimes far more often than during one,
// and the device answers 410. Reporting that would put a line in the log for
// every acknowledgement that worked exactly as intended, which was the first
// thing running this on a real bar showed.
//
// A real failure is reported rather than thrown. The worst it costs is under two
// seconds of sound that was going to end on its own, which is not worth taking a
// program down for.
const stopAlert = async (
	bar: BusyBar,
	log: (message: string) => void,
): Promise<void> => {
	try {
		await bar.AudioStop();
	} catch (error) {
		if (isNotHappening(error)) {
			return;
		}

		log(`could not stop the alert sound: ${describe(error)}`);
	}
};

export { ALERT_SOUND, playAlert, stopAlert };
