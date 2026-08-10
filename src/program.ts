import type { BusyBar } from "@busy-app/busy-lib";

// What a program is handed when it draws.
interface ProgramContext {
	readonly bar: BusyBar;
	// Elements on the device are namespaced by application name. Each program
	// gets its own, so clearing one program's drawings leaves the rest alone.
	readonly applicationName: string;
	// The tool's own log, so that a program can report something that is worth
	// knowing but not worth failing over -- and report it the same way the
	// runner does, rather than writing to the terminal on its own account.
	//
	// Anything a program cannot carry on without belongs in a thrown error
	// instead: the runner puts those on the bar, and a line in a log that
	// nobody is watching is exactly what drawing failures exists to avoid.
	readonly log: (message: string) => void;
}

// What a draw tells the runner about when to come back.
//
// Programs schedule themselves rather than being polled on a fixed interval,
// because the interesting moments are rarely evenly spaced: a focus block
// changes colour at two known instants and is otherwise static, and the device
// keeps a countdown ticking on its own in between. Asking for the next draw at
// the moment it is actually needed keeps the screen exact without redrawing --
// which matters, because redrawing restarts scroll animations.
interface DrawResult {
	// Milliseconds until the program wants to draw again, measured from when
	// the draw finished. Leave it off to say "do not come back": the device
	// sustains what was drawn without further help.
	readonly nextDrawInMs?: number;
}

// An operating mode: one thing the bar can be doing.
//
// The model is deliberately small -- a program says what to put on screen and
// when it wants to be asked again, and the runner owns connecting, waiting,
// preemption, and cleanup. That covers everything drawing-shaped. A program
// that needs to react to button presses or device state will need this
// contract to grow.
interface Program {
	// Also used verbatim as the device-side application name, so it has to
	// match ^[a-zA-Z0-9._-]+$.
	readonly name: string;
	readonly description: string;
	// One-time preparation before the first draw: reading configuration,
	// fetching a schedule, whatever the program cannot work without.
	//
	// Failing here is fatal, unlike failing a draw. A draw fails for reasons
	// that pass -- a focus session owns the screen, a request times out -- so
	// the runner retries. Preparation fails because the program cannot do its
	// job at all, and retrying that forever only buries the reason.
	readonly start?: (context: ProgramContext) => Promise<void>;
	readonly draw: (context: ProgramContext) => Promise<DrawResult>;
}

export type { DrawResult, Program, ProgramContext };
