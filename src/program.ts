import type { BusyBar } from "@busy-app/busy-lib";
import type { ConfigSection } from "./config/section.ts";

// What a program is handed when it draws.
interface ProgramContext {
	readonly bar: BusyBar;
	// This program's block of the config file, and the only thing it is
	// configured by. A program reads its own settings -- nothing central knows
	// what `focus` takes -- but it reads them from here rather than from the
	// environment or a file of its own, so every setting in the tool is
	// written in one place and validated the same way.
	readonly config: ConfigSection;
	// Elements on the device are namespaced by application name. Each program
	// gets its own, so clearing one program's drawings leaves the rest alone.
	readonly applicationName: string;
	// The priority every draw this program makes has to carry: what the program
	// asked for, or the default if it asked for nothing. Handed over rather
	// than imported so that a program draws at its own priority without having
	// to know whether that is the default one.
	readonly priority: number;
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
//
// Several can run at once, and they are not coordinated with each other:
// each draws whenever it has something to say, and the device decides which
// of them is actually on screen by comparing priorities. A program is
// therefore written as though it owned the display, and has to tolerate not
// getting it -- which is what the runner's retry on preemption is for.
interface Program {
	// Also used verbatim as the device-side application name, so it has to
	// match ^[a-zA-Z0-9._-]+$.
	readonly name: string;
	readonly description: string;
	// How far this program outranks the rest, in [1, 100]. Left off, it draws
	// at DEFAULT_DRAW_PRIORITY like everything ordinary.
	//
	// This is the whole of the arbitration between programs running together:
	// the device gives the screen to the highest priority asking for it, and
	// answers everyone else 409 until that program stops drawing. Raising it is
	// a claim that this program is worth interrupting the others for, and worth
	// interrupting them for as long as it keeps drawing -- so it belongs to
	// programs that speak up rarely and briefly, not to ones that are always
	// on.
	//
	// Two programs at the same priority do not share the screen: the first to
	// draw keeps it, and the other is preempted for as long as it is up.
	readonly priority?: number;
	// One-time preparation before the first draw: reading configuration,
	// fetching a schedule, whatever the program cannot work without.
	//
	// Failing here is fatal, unlike failing a draw. A draw fails for reasons
	// that pass -- a focus session owns the screen, a request times out -- so
	// the runner retries. Preparation fails because the program cannot do its
	// job at all, and retrying that forever only buries the reason.
	//
	// A program with settings reads them here, even if it reads them again
	// later. The runner holds the config block to the settings this asked for
	// and refuses the rest, so a setting first read during a draw is a setting
	// the file would be told it does not have.
	readonly start?: (context: ProgramContext) => Promise<void>;
	readonly draw: (context: ProgramContext) => Promise<DrawResult>;
}

export type { DrawResult, Program, ProgramContext };
