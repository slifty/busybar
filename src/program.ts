import type { BusyBar } from "@busy-app/busy-lib";

// What a program is handed when it draws.
interface ProgramContext {
	readonly bar: BusyBar;
	// Elements on the device are namespaced by application name. Each program
	// gets its own, so clearing one program's drawings leaves the rest alone.
	readonly applicationName: string;
}

// An operating mode: one thing the bar can be doing.
//
// The model is deliberately small -- a program says what to put on screen, and
// the runner owns connecting, scheduling, preemption, and cleanup. That covers
// everything drawing-shaped. A program that needs to react to button presses
// or device state will need this contract to grow.
interface Program {
	// Also used verbatim as the device-side application name, so it has to
	// match ^[a-zA-Z0-9._-]+$.
	readonly name: string;
	readonly description: string;
	// How often `draw` is called after the initial draw. Leave it off for
	// programs that put something on screen the device sustains by itself;
	// redrawing restarts animations, so it is not always harmless.
	readonly refreshIntervalMs?: number;
	readonly draw: (context: ProgramContext) => Promise<void>;
}

export type { Program, ProgramContext };
