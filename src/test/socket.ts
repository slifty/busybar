import { vi } from "vitest";

// A stand-in for the WebSocket the device's state stream arrives on.
//
// The stream is the one part of this tool that is not HTTP, and the things
// worth testing about it are all about a connection's life rather than about
// what comes down it: that the device is asked to start streaming, that a drop
// is reconnected, and that shutting down stops both. None of that is reachable
// through a real socket without a real bar on the end of a cable.
//
// Only what `src/input/stream.ts` actually uses is implemented, so reaching for
// anything else fails loudly rather than quietly doing nothing.

type Listener = (event: unknown) => void;

interface FakeSocket {
	readonly url: string;
	// Everything the tool sent, which is one message: the request to start
	// streaming.
	readonly sent: string[];
	readonly closedByUs: () => boolean;
	// Firing what the device would do.
	readonly open: () => void;
	readonly deliver: (data: ArrayBufferLike | string) => void;
	readonly drop: () => void;
	readonly fail: () => void;
}

interface FakeSockets {
	// Every socket opened since the last install, in order, so a test can say
	// that a second one was opened after the first dropped.
	readonly opened: FakeSocket[];
	readonly latest: () => FakeSocket | undefined;
	// Takes over the global WebSocket, and hands it back. Separate from
	// building this so that a suite can hold one of these in a `const` and
	// install it per test.
	readonly install: () => void;
	readonly restore: () => void;
}

const createFakeSocket = (url: string): FakeSocket => {
	const listeners = new Map<string, Listener[]>();
	const sent: string[] = [];

	let closed = false;

	const fire = (type: string, event: unknown): void => {
		for (const listener of listeners.get(type) ?? []) {
			listener(event);
		}
	};

	const socket = {
		url,
		binaryType: "blob",
		addEventListener: (type: string, listener: Listener) => {
			listeners.set(type, [...(listeners.get(type) ?? []), listener]);
		},
		send: (message: string) => {
			sent.push(message);
		},
		close: () => {
			closed = true;
		},
	};

	return Object.assign(socket, {
		sent,
		closedByUs: () => closed,
		open: () => {
			fire("open", {});
		},
		deliver: (data: ArrayBufferLike | string) => {
			fire("message", { data });
		},
		drop: () => {
			fire("close", {});
		},
		fail: () => {
			fire("error", {});
			fire("close", {});
		},
	});
};

// The count of sockets a fresh test has opened.
const NONE = 0;

// The most recently opened socket.
const LAST = -1;

// Something that can replace the global WebSocket for the length of a test.
const fakeSockets = (): FakeSockets => {
	const opened: FakeSocket[] = [];

	// A plain function rather than a class. `new` on a function that returns an
	// object hands back that object, which is what lets each socket be a
	// closure over its own listeners instead of an instance carrying methods --
	// and keeps this the only shape of thing in the repository.
	const FakeWebSocket = function fakeWebSocket(url: string): FakeSocket {
		// The real constructor refuses an address the URL parser cannot read,
		// and refuses it synchronously rather than through an event -- which is
		// a thing the code under test has to survive, so the fake has to do it
		// too. A fake that accepted anything would make that path untestable
		// and, worse, make it look tested.
		const refused = new URL(url);

		void refused;

		const socket = createFakeSocket(url);

		opened.push(socket);

		return socket;
	};

	return {
		opened,
		latest: () => opened.at(LAST),
		install: () => {
			opened.length = NONE;
			vi.stubGlobal("WebSocket", FakeWebSocket);
		},
		restore: () => {
			vi.unstubAllGlobals();
		},
	};
};

export { fakeSockets };
export type { FakeSocket, FakeSockets };
