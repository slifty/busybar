import type { BusyBar } from "@busy-app/busy-lib";

type DrawCall = Parameters<BusyBar["DisplayDraw"]>[0];
type ClearCall = Parameters<BusyBar["DisplayClear"]>[0];

interface FakeBar {
	readonly bar: BusyBar;
	readonly draws: DrawCall[];
	readonly clears: ClearCall[];
}

// A stand-in for the device that records what it was asked to draw.
//
// Only the handful of methods a program actually calls are implemented, so
// reaching for anything else fails loudly as a TypeError rather than quietly
// doing nothing -- which is what we want from a fake.
const createFakeBar = (): FakeBar => {
	const draws: DrawCall[] = [];
	const clears: ClearCall[] = [];

	const bar = {
		DisplayDraw: async (params: DrawCall) => {
			draws.push(params);

			return await Promise.resolve({});
		},
		DisplayClear: async (params: ClearCall) => {
			clears.push(params);

			return await Promise.resolve({});
		},
	};

	return {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion -- a fake implements only what programs call, not all of BusyBar
		bar: bar as unknown as BusyBar,
		draws,
		clears,
	};
};

export { createFakeBar };
export type { FakeBar };
