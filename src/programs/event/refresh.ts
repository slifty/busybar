import { describe } from "../../errors.ts";
import { loadAppointments } from "./appointments.ts";
import type { ProgramContext } from "../../program.ts";
import type { Appointment } from "./appointment.ts";
import type { EventSettings } from "./settings.ts";

// Keeps the appointments up to date, on a clock of its own.
//
// Reading the calendars used to happen inside `draw`, which tied how fresh the
// data was to how often the program had a reason to draw -- and those are not
// the same question. Drawing is about the next few seconds and happens when
// something on the screen has to change; reading is about the next few hours
// and should happen whether or not anything is on screen at all. Tied together,
// a program with nothing to show had to be woken on a timer purely to look at a
// file, and a program chiming every ten seconds re-read every feed every ten
// seconds to redraw pixels it had already drawn.
//
// So this reads on its own interval and `draw` uses whatever it last read.

// A fingerprint of what was read, for telling a change from a re-read.
//
// The bar only ever speaks about an appointment's name, start and kind, so two
// reads that agree about all three are the same day as far as anything here is
// concerned -- and a redraw for a feed that merely changed the ordering of its
// entries would be a redraw nobody could see.
const fingerprint = (appointments: readonly Appointment[]): string =>
	appointments
		.map(({ name, start, kind }) => `${start.toISOString()} ${kind} ${name}`)
		.sort()
		.join("\n");

interface Refresher {
	// The appointments as of the last successful read.
	readonly appointments: () => readonly Appointment[];
	// What stopped the last read, if it failed.
	//
	// Handed back rather than logged and forgotten, because a feed that cannot
	// be read has to reach the display: silence is what this program looks like
	// when it is working, so a bar quietly showing nothing because it has not
	// managed to read a calendar since breakfast is the exact failure worth
	// making loud.
	readonly failure: () => Error | undefined;
	// Reads once, then again on the interval until stopped. The first read is
	// awaited, so a feed that cannot be reached at startup fails `start` rather
	// than surfacing minutes later.
	readonly begin: (
		settings: EventSettings,
		context: ProgramContext,
	) => Promise<void>;
	readonly stop: () => void;
}

const createRefresher = (): Refresher => {
	let appointments: readonly Appointment[] = [];
	let failure: Error | undefined = undefined;
	let timer: NodeJS.Timeout | undefined = undefined;

	// `wake` is off for the very first read, which is a baseline rather than
	// news: the runner draws the program as soon as it has started anyway, and
	// there is no draw loop yet to bring forward.
	const read = async (
		settings: EventSettings,
		context: ProgramContext,
		wake: boolean,
	): Promise<void> => {
		const before = fingerprint(appointments);
		const read = await loadAppointments(settings);

		// Reads never overlap: the first is awaited, and each one afterwards is
		// scheduled only once the last has finished, so there is no interleaved
		// update to lose.
		// eslint-disable-next-line require-atomic-updates -- reads are serialised by the loop below
		appointments = read;
		failure = undefined;

		// Only when the day actually changed. A read that came back saying the
		// same thing is not news, and drawing on it would have the program
		// redrawing on the refresh interval for as long as it runs -- which is
		// the coupling this exists to remove.
		if (wake && fingerprint(appointments) !== before) {
			context.redraw();
		}
	};

	const scheduleNext = (
		settings: EventSettings,
		context: ProgramContext,
	): void => {
		timer = setTimeout(() => {
			void (async (): Promise<void> => {
				try {
					await read(settings, context, true);
				} catch (error) {
					failure = error instanceof Error ? error : new Error(describe(error));

					// The failure belongs on the bar, and only a draw puts it
					// there.
					context.redraw();
				}

				scheduleNext(settings, context);
			})();
		}, settings.refreshMs);

		// Reading a calendar is not a reason to keep the process alive. Without
		// this, a tool asked to stop would sit waiting out the interval first.
		timer.unref();
	};

	return {
		appointments: () => appointments,
		failure: () => failure,
		begin: async (settings, context) => {
			// A second run in the same process -- which is every run after the
			// first in the test suite -- must not leave the first one's timer
			// reading on its own account.
			clearTimeout(timer);

			await read(settings, context, false);
			scheduleNext(settings, context);
		},
		stop: () => {
			clearTimeout(timer);
		},
	};
};

export { createRefresher, fingerprint };
export type { Refresher };
