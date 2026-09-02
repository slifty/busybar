import type { Alert } from "./alerts.ts";

// Which alerts have been answered by a press of the bar.
//
// An acknowledged alert is one the bar stops speaking about: the sound stops,
// it comes off the screen, and neither comes back. Without somewhere to
// remember that, the next draw would find the same alert in the same window and
// put it straight back up -- so this is what makes the button do anything at
// all.
//
// It is kept in memory and nowhere else. Acknowledgement is a fact about the
// last few minutes -- an alert you have seen and dealt with -- and a restarted
// process is one that was not there when you pressed the button, so having it
// forget is right rather than merely convenient.

// An alert, as something to look up.
//
// The appointment it is about and the trigger it is for. The trigger is in the
// key because an entry's alarms are separate interruptions: answering the
// reminder that came the day before must not silence the one that catches you
// on the way out, which is the whole reason a calendar carries two.
//
// Two calendars carrying the same meeting produce alerts with the same key, and
// acknowledging one acknowledges both -- which is what you meant, since the bar
// was only ever showing you one of them.
const keyOf = ({ appointment: { name, start }, trigger }: Alert): string =>
	`${start.toISOString()} ${trigger.toISOString()} ${name}`;

interface Acknowledgements {
	readonly acknowledge: (alert: Alert) => void;
	readonly has: (alert: Alert) => boolean;
	// Forgets every acknowledgement that is not about one of these alerts.
	//
	// The calendars only ever hand back what falls near now, so an appointment
	// drops out of them once it is past -- and an acknowledgement of something
	// nothing can name any more is not a fact about anything. Pruning against
	// the current pool rather than against a clock is what keeps this from
	// growing for as long as the process runs, without inventing a second
	// answer to how long an appointment stays interesting.
	readonly keepOnly: (alerts: readonly Alert[]) => void;
}

const createAcknowledgements = (): Acknowledgements => {
	const answered = new Set<string>();

	return {
		acknowledge: (alert) => {
			answered.add(keyOf(alert));
		},
		has: (alert) => answered.has(keyOf(alert)),
		keepOnly: (alerts) => {
			const known = new Set(alerts.map(keyOf));

			for (const key of answered) {
				if (!known.has(key)) {
					answered.delete(key);
				}
			}
		},
	};
};

export { createAcknowledgements, keyOf };
export type { Acknowledgements };
