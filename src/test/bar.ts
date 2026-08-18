import type { BusyBar } from "@busy-app/busy-lib";

type DrawCall = Parameters<BusyBar["DisplayDraw"]>[0];
type ClearCall = Parameters<BusyBar["DisplayClear"]>[0];
type PlayCall = Parameters<BusyBar["AudioPlay"]>[0];

interface FakeBar {
	readonly bar: BusyBar;
	readonly draws: DrawCall[];
	readonly clears: ClearCall[];
	readonly plays: PlayCall[];
	// How many times the bar was told to stop making a noise. There is nothing
	// to record about it: the device takes no parameters and stops whatever is
	// playing.
	readonly stops: () => number;
	// Every call in the order it was made, so a test can assert that a clear
	// happened *before* a draw rather than merely that both happened -- which
	// is the whole of what keeps an error from landing on top of a drawing.
	readonly calls: Array<"draw" | "clear" | "play" | "stop">;
	// Set to make every subsequent draw or clear reject, and unset to let them
	// through again. A device that refuses is half of what the runner is for,
	// so a fake that can only succeed cannot exercise it.
	drawRejectsWith: Error | undefined;
	clearRejectsWith: Error | undefined;
	// The device answers 410 when told to stop a sound that is not playing, so
	// a fake that could only succeed could not exercise the one call this tool
	// makes and deliberately does not mind failing.
	stopRejectsWith: Error | undefined;
}

// A stand-in for the device that records what it was asked to draw.
//
// Only the handful of methods a program actually calls are implemented, so
// reaching for anything else fails loudly as a TypeError rather than quietly
// doing nothing -- which is what we want from a fake.
const createFakeBar = (): FakeBar => {
	const draws: DrawCall[] = [];
	const clears: ClearCall[] = [];
	const plays: PlayCall[] = [];
	const calls: Array<"draw" | "clear" | "play" | "stop"> = [];

	let stopped = 0;

	const fake = {
		draws,
		clears,
		plays,
		calls,
		stops: () => stopped,
		drawRejectsWith: undefined as Error | undefined,
		clearRejectsWith: undefined as Error | undefined,
		stopRejectsWith: undefined as Error | undefined,
	};

	const bar = {
		DisplayDraw: async (params: DrawCall) => {
			if (fake.drawRejectsWith !== undefined) {
				throw fake.drawRejectsWith;
			}

			draws.push(params);
			calls.push("draw");

			return await Promise.resolve({});
		},
		DisplayClear: async (params: ClearCall) => {
			if (fake.clearRejectsWith !== undefined) {
				throw fake.clearRejectsWith;
			}

			clears.push(params);
			calls.push("clear");

			return await Promise.resolve({});
		},
		AudioPlay: async (params: PlayCall) => {
			plays.push(params);
			calls.push("play");

			return await Promise.resolve({});
		},
		AudioStop: async () => {
			if (fake.stopRejectsWith !== undefined) {
				throw fake.stopRejectsWith;
			}

			stopped += 1;
			calls.push("stop");

			return await Promise.resolve({});
		},
	};

	// Assigned onto the same object the methods above close over, rather than
	// spread into a new one -- a copy would leave a test setting
	// `drawRejectsWith` on an object the fake device never reads.
	return Object.assign(fake, {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a fake implements only what programs call, not all of BusyBar
		bar: bar as unknown as BusyBar,
	});
};

export { createFakeBar };
export type { FakeBar };
