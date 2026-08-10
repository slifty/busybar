import { covers } from "./focus.ts";
import type { Focus } from "./focus.ts";

// A resolved run of focus blocks: at most one covers any given instant.
//
// This is the seam a calendar will plug into. Where the blocks came from -- a
// file, a subscribed calendar, several of them -- stops mattering once they
// are here, and the rest of the program only ever asks two questions.
interface Schedule {
	// The block covering this instant, if there is one.
	readonly activeAt: (at: Date) => Focus | undefined;
	// The first block that has not started yet, if there is one.
	readonly nextAfter: (at: Date) => Focus | undefined;
}

const overlaps = (a: Focus, b: Focus): boolean =>
	a.start.getTime() < b.end.getTime() && b.start.getTime() < a.end.getTime();

// Drops every block that overlaps one already kept, and returns what is left
// in start order.
//
// Overlap is resolved by discarding, not by trimming: a block that collides
// with a kept one by any amount is ignored outright, rather than being shown
// for whatever part of it is free. Earliest start wins, and blocks that start
// together are settled by their order in the input -- `sort` is stable, so
// leaving equal starts untouched preserves it.
//
// Only the last kept block can collide with the next candidate. Kept blocks
// never overlap each other and are in start order, so each one ends no later
// than the next begins, which puts the latest end of the whole run at the end
// of the last block.
const withoutOverlaps = (blocks: readonly Focus[]): Focus[] => {
	const ordered = [...blocks].sort(
		(a, b) => a.start.getTime() - b.start.getTime(),
	);

	const kept: Focus[] = [];
	let previous: Focus | undefined = undefined;

	for (const block of ordered) {
		if (previous === undefined || !overlaps(previous, block)) {
			kept.push(block);
			previous = block;
		}
	}

	return kept;
};

// Resolves a set of blocks into a schedule.
//
// Overlaps are settled once, here, so that nothing downstream has to wonder
// which of two blocks is the real one.
const createSchedule = (blocks: readonly Focus[]): Schedule => {
	const resolved = withoutOverlaps(blocks);

	return {
		activeAt: (at) => resolved.find((focus) => covers(focus, at)),
		// `resolved` is in start order, so the first match is the soonest.
		nextAfter: (at) =>
			resolved.find((focus) => focus.start.getTime() > at.getTime()),
	};
};

export { createSchedule, withoutOverlaps };
export type { Schedule };
