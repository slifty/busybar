import type { Appointment } from "./appointment.ts";

// Which alerts have been answered by a press of the bar.
//
// An acknowledged appointment is one the bar stops speaking about: the sound
// stops, the alert comes off the screen, and neither comes back. Without
// somewhere to remember that, the next draw would find the same appointment in
// the same window and put the same alert straight back up -- so this is what
// makes the button do anything at all.
//
// It is kept in memory and nowhere else. Acknowledgement is a fact about the
// last few minutes -- an alert you have seen and dealt with -- and a restarted
// process is one that was not there when you pressed the button, so having it
// forget is right rather than merely convenient.

// An appointment, as something to look up.
//
// Its start and its name, which is everything the bar knows about it and
// everything it draws. Two calendars carrying the same meeting produce two
// appointments with the same key, and acknowledging one acknowledges both --
// which is what you meant, since the bar was only ever showing you one alert.
const keyOf = ({ name, start }: Appointment): string =>
	`${start.toISOString()} ${name}`;

interface Acknowledgements {
	readonly acknowledge: (appointment: Appointment) => void;
	readonly has: (appointment: Appointment) => boolean;
	// Forgets every acknowledgement that is not about one of these
	// appointments.
	//
	// The calendars only ever hand back what falls near now, so an appointment
	// drops out of them once it is past -- and an acknowledgement of something
	// nothing can name any more is not a fact about anything. Pruning against
	// the current pool rather than against a clock is what keeps this from
	// growing for as long as the process runs, without inventing a second
	// answer to how long an appointment stays interesting.
	readonly keepOnly: (appointments: readonly Appointment[]) => void;
}

const createAcknowledgements = (): Acknowledgements => {
	const answered = new Set<string>();

	return {
		acknowledge: (appointment) => {
			answered.add(keyOf(appointment));
		},
		has: (appointment) => answered.has(keyOf(appointment)),
		keepOnly: (appointments) => {
			const known = new Set(appointments.map(keyOf));

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
