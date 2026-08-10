import { MS_PER_MINUTE } from "../../constants/time.ts";

// A block of time set aside for one thing.
//
// Unlike an appointment, where what matters is being on time for the start, a
// focus block is about its whole span: what you should be thinking about now,
// and how much of it is left.
interface Focus {
	readonly name: string;
	readonly start: Date;
	readonly end: Date;
}

// A focus block is treated as three stretches, drawn in different colours:
// settling into the work, being in it, and wrapping it up.
const RAMP_UP_MINUTES = 15;
const WIND_DOWN_MINUTES = 15;

const RAMP_UP_MS = RAMP_UP_MINUTES * MS_PER_MINUTE;
const WIND_DOWN_MS = WIND_DOWN_MINUTES * MS_PER_MINUTE;

// Chosen for an LED matrix rather than a screen: each has to be unmistakable
// at a glance and from an angle, which rules out the darker end of blue.
const PHASE_COLOR = {
	rampUp: "#3366FFFF",
	settled: "#33CC66FF",
	windDown: "#FF9900FF",
} as const;

type Phase = keyof typeof PHASE_COLOR;

// Whether an instant falls inside the block. The span is half-open, [start,
// end), so a block ending at 10:00 has already released the screen by the time
// one starting at 10:00 claims it.
const covers = ({ start, end }: Focus, at: Date): boolean =>
	start.getTime() <= at.getTime() && at.getTime() < end.getTime();

const phaseAt = ({ start, end }: Focus, at: Date): Phase => {
	// Wind-down is tested first so that it wins when the two stretches would
	// overlap -- any block shorter than half an hour. On a twenty-minute
	// block, being told to wrap up is worth more than being told you have
	// just started, so such a block reads blue for five minutes and orange
	// for fifteen rather than the other way round.
	if (end.getTime() - at.getTime() <= WIND_DOWN_MS) {
		return "windDown";
	}

	if (at.getTime() - start.getTime() < RAMP_UP_MS) {
		return "rampUp";
	}

	return "settled";
};

const colorFor = (phase: Phase): string => PHASE_COLOR[phase];

// When the block will next look different, so a program knows when to draw
// again rather than polling to find out.
//
// The candidates are the two stretch boundaries, and the answer is the first
// one that actually changes the colour. Filtering on the phase rather than
// just taking the next boundary matters on short blocks, where a boundary can
// fall inside a stretch it does not begin: on a twenty-minute block the
// fifteen-minute mark is already wind-down, and waking up to redraw the same
// orange would restart the scroll on a long name for nothing.
//
// Falls back to the end of the block, which is always a change: the block
// stops being drawn.
const nextPhaseChangeAt = (focus: Focus, at: Date): Date => {
	const { start, end } = focus;
	const current = phaseAt(focus, at);

	const [change] = [
		new Date(start.getTime() + RAMP_UP_MS),
		new Date(end.getTime() - WIND_DOWN_MS),
	]
		.filter(
			(boundary) =>
				boundary.getTime() > at.getTime() &&
				boundary.getTime() < end.getTime() &&
				phaseAt(focus, boundary) !== current,
		)
		.sort((a, b) => a.getTime() - b.getTime());

	return change ?? end;
};

export { colorFor, covers, nextPhaseChangeAt, phaseAt };
export type { Focus, Phase };
