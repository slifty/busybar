import type { BusyBar } from "@busy-app/busy-lib";
import type { ConfigSection } from "./config/section.ts";
import type { Button } from "./input/buttons.ts";

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
	// Asks to be drawn now rather than when the last draw said to come back.
	//
	// A program schedules its own draws from what it knew at the time, and
	// sometimes something else learns otherwise -- a calendar gains a meeting
	// that starts in two minutes while the program is asleep until tomorrow.
	// This is how the thing that found out says so.
	//
	// It never draws twice at once: a call while a draw is in flight is
	// honoured after that draw rather than alongside it. Calling it before the
	// run has started -- from `start` -- does nothing, since there is no draw
	// loop yet to bring forward.
	readonly redraw: () => void;
	// Says that this program has stopped occupying the display, so that every
	// other program draws again now.
	//
	// This exists because of how the device arbitrates the screen, which is
	// harsher than it looks: a draw from a higher priority does not cover a
	// lower-priority application's elements, it destroys them. They do not come
	// back when the interruption ends, and their owner has no way to know they
	// are gone -- its own draw succeeded, so the runner never saw the 409 that
	// would have had it retry.
	//
	// So a program that interrupts the others has to tell them when it is done.
	// Nothing else can: the device reports no such event, and a program that
	// polled for it would be redrawing constantly to find out.
	readonly releaseScreen: () => void;
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

// What reacting to a press tells the runner.
//
// A handler does its own work -- stopping a sound, forgetting an alert -- and
// this says only whether the screen is now wrong. It is separate from
// `DrawResult` because a press does not get to reschedule the program: what a
// draw asked for still stands, and the press either brings the next one
// forward to now or leaves it alone.
interface InputResult {
	// Whether the program wants to be drawn now rather than when it last asked
	// to be. Left off, the press changed nothing the screen is showing.
	readonly redraw?: boolean;
}

// An operating mode: one thing the bar can be doing.
//
// The model is deliberately small -- a program says what to put on screen and
// when it wants to be asked again, and the runner owns connecting, waiting,
// preemption, cleanup, and listening to the bar's buttons.
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
	// Someone pressed one of the bar's three buttons.
	//
	// Declaring this is what opens the device's state stream at all: it is the
	// tool's one non-HTTP connection to the bar, and a run of programs that
	// none of them react to presses does not open it. See `src/input/`.
	//
	// Every program that declares one hears every press. The bar has no notion
	// of which program a press was meant for -- it has three buttons and no
	// concept of ours on screen -- so a program has to decide for itself
	// whether a press is anything to do with it, and the honest answer is
	// usually no. Reporting a press to a program that is showing nothing is
	// how a press ends up acknowledging an alert that is not there.
	//
	// It runs alongside the draw loop rather than inside it, so a press is
	// heard while the program is waiting rather than only when it next draws.
	// The runner still never lets two draws overlap.
	readonly onButton?: (
		button: Button,
		context: ProgramContext,
	) => Promise<InputResult>;
}

export type { DrawResult, InputResult, Program, ProgramContext };
