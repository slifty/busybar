import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { bytesOf, messageField, numberField } from "../../test/protobuf.ts";
import { fakeSockets } from "../../test/socket.ts";
import { endpointFor, watchButtons } from "../stream.ts";
import type { Button } from "../buttons.ts";

const ADDRESS = "10.0.4.20";

// A state message carrying one press of `back`.
const { buffer: BACK_PRESS } = bytesOf(
	messageField(2, messageField(11, messageField(1, numberField(1, 1)))),
);

interface Watching {
	readonly presses: Button[];
	readonly logs: string[];
	readonly stop: () => void;
}

const start = (address: string = ADDRESS): Watching => {
	const presses: Button[] = [];
	const logs: string[] = [];
	const controller = new AbortController();

	watchButtons({
		address,
		onPress: (button) => {
			presses.push(button);
		},
		log: (message) => {
			logs.push(message);
		},
		signal: controller.signal,
	});

	return {
		presses,
		logs,
		stop: () => {
			controller.abort();
		},
	};
};

const sockets = fakeSockets();

beforeEach(() => {
	vi.useFakeTimers();
	sockets.install();
});

afterEach(() => {
	sockets.restore();
	vi.useRealTimers();
});

describe("endpointFor", () => {
	it("takes an address written the way it is printed on the bar", () => {
		expect(endpointFor("10.0.4.20")).toBe("ws://10.0.4.20/api/status/ws");
	});

	// `busy-lib` accepts a scheme on the same setting, so one address in the
	// file cannot mean two different things depending on which part of the tool
	// is reading it.
	it("takes an address with a scheme on it", () => {
		expect(endpointFor("http://10.0.4.20")).toBe(
			"ws://10.0.4.20/api/status/ws",
		);
	});

	it("keeps a secure address secure", () => {
		expect(endpointFor("https://bar.test")).toBe(
			"wss://bar.test/api/status/ws",
		);
	});

	it("does not double the slash on an address that ends with one", () => {
		expect(endpointFor("http://10.0.4.20/")).toBe(
			"ws://10.0.4.20/api/status/ws",
		);
	});
});

describe("watchButtons", () => {
	// The device says nothing until it is asked to.
	it("asks the device to start streaming", () => {
		const watching = start();

		sockets.latest()?.open();

		expect(sockets.latest()?.sent).toStrictEqual(['{"enable":true}']);

		watching.stop();
	});

	it("reports a press", () => {
		const watching = start();

		sockets.latest()?.open();
		sockets.latest()?.deliver(BACK_PRESS);

		expect(watching.presses).toStrictEqual(["back"]);

		watching.stop();
	});

	it("ignores anything that does not arrive as bytes", () => {
		const watching = start();

		sockets.latest()?.open();
		sockets.latest()?.deliver("hello");

		expect(watching.presses).toStrictEqual([]);

		watching.stop();
	});

	// One message it cannot read would mean the firmware had moved the field
	// this walks, which is worth saying and is not worth taking acknowledgement
	// down over.
	it("carries on after a message it cannot read", () => {
		const watching = start();

		sockets.latest()?.open();
		sockets.latest()?.deliver(new Uint8Array([0x0b]).buffer);
		sockets.latest()?.deliver(BACK_PRESS);

		expect(watching.logs.join(" ")).toMatch(/could not read/v);
		expect(watching.presses).toStrictEqual(["back"]);

		watching.stop();
	});

	// Constructing the socket throws for an address the URL parser refuses, and
	// it is called both directly and from a timer -- so left uncaught it takes
	// down a run, or the process, over a typo in a setting.
	describe("when the address cannot be made into a URL", () => {
		const BAD_ADDRESS = "10.0.4.20 with a space";

		it("does not throw", () => {
			expect(() => start(BAD_ADDRESS)).not.toThrow();
		});

		it("says so, once", () => {
			const watching = start(BAD_ADDRESS);

			vi.advanceTimersByTime(5_000);
			vi.advanceTimersByTime(5_000);

			expect(watching.logs).toStrictEqual([
				expect.stringMatching(/cannot listen for button presses/v),
			]);

			watching.stop();
		});

		it("stops trying when the run stops", () => {
			const watching = start(BAD_ADDRESS);

			watching.stop();
			vi.advanceTimersByTime(5_000);

			expect(sockets.opened).toStrictEqual([]);
		});
	});

	describe("when the stream drops", () => {
		it("connects again", () => {
			const watching = start();

			sockets.latest()?.open();
			sockets.latest()?.drop();

			expect(sockets.opened).toHaveLength(1);

			vi.advanceTimersByTime(5_000);

			expect(sockets.opened).toHaveLength(2);

			watching.stop();
		});

		it("hears presses on the new connection", () => {
			const watching = start();

			sockets.latest()?.open();
			sockets.latest()?.fail();
			vi.advanceTimersByTime(5_000);

			sockets.latest()?.open();
			sockets.latest()?.deliver(BACK_PRESS);

			expect(watching.presses).toStrictEqual(["back"]);

			watching.stop();
		});

		// Reported once per outage rather than once per attempt, or a bar that
		// is simply unplugged fills the log with the same line.
		it("says so once, and says so again when it comes back", () => {
			const watching = start();

			sockets.latest()?.open();
			sockets.latest()?.drop();
			vi.advanceTimersByTime(5_000);
			sockets.latest()?.drop();
			vi.advanceTimersByTime(5_000);
			sockets.latest()?.open();

			expect(watching.logs).toStrictEqual([
				"listening for button presses",
				"not listening for button presses; retrying",
				"listening for button presses",
			]);

			watching.stop();
		});
	});

	describe("when the run is stopping", () => {
		// The socket would otherwise hold the process open past Ctrl-C.
		it("closes the connection", () => {
			const watching = start();

			sockets.latest()?.open();
			watching.stop();

			expect(sockets.latest()?.closedByUs()).toBe(true);
		});

		it("stops reconnecting", () => {
			const watching = start();

			sockets.latest()?.open();
			watching.stop();
			sockets.latest()?.drop();
			vi.advanceTimersByTime(5_000);

			expect(sockets.opened).toHaveLength(1);
		});
	});
});
