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

// How long between one playing of the chime and the next.
//
// The clip is under two seconds and the alert is supposed to continue until it
// is acknowledged, so it has to be played again and again rather than once.
// Ten seconds leaves a clear gap between chimes -- which is what makes it read
// as an alarm asking for an answer rather than as a siren -- and is slow enough
// that the calendars are not re-read every couple of seconds for as long as it
// goes on, since a repeat costs a draw and a draw reads the feeds.
const REPEAT_MS = 10_000;

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

export { ALERT_SOUND, REPEAT_MS, playAlert, stopAlert };
