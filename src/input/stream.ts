import { describe } from "../errors.ts";
import { pressesIn } from "./buttons.ts";
import type { Button } from "./buttons.ts";

// The bar's buttons, as they reach a Node process.
//
// This is the tool's only connection to the device that is not HTTP, and it is
// here because there is no HTTP answer. `POST /api/input` sends a keypress to
// the bar; nothing reports one coming back, and no `/api/status` endpoint
// carries the buttons. What does carry them is the device's own state stream,
// which is protobuf over a WebSocket -- so a program that reacts to a press
// needs this, or it needs to not react to presses.
//
// `busy-lib` wraps that stream in a SharedWorker and is therefore browser-only,
// but the protocol underneath is not: a plain WebSocket connects, `{"enable":
// true}` starts the flow, and the messages decode without a browser anywhere.
// See `src/input/protobuf.ts` for how little of the format that takes.

const STATUS_STREAM_PATH = "/api/status/ws";

const HTTP_SCHEME = "http://";
const HTTPS_SCHEME = "https://";
const WS_SCHEME = "ws://";
const WSS_SCHEME = "wss://";

// The device sends nothing until it is asked to.
const ENABLE_STREAMING = JSON.stringify({ enable: true });

// How long to wait before connecting again after the stream drops.
//
// The bar is on the end of a USB cable, so a drop is usually the cable, a
// reboot, or a firmware update -- none of which is helped by reconnecting
// faster, and all of which end. This is short enough that a press is being
// listened for again within a few seconds of the bar coming back, and long
// enough that a device which is simply gone is not being dialled continuously
// for as long as the tool runs.
const RECONNECT_DELAY_MS = 5_000;

// Where the state stream is, given a device address that may or may not carry
// a scheme.
//
// The address in the config file is written the way it is printed on the back
// of the bar -- `10.0.4.20` -- but `http://10.0.4.20` is just as reasonable a
// thing to write, and `busy-lib` accepts both, so this does too rather than
// having one setting mean two different things depending on which part of the
// tool is reading it.
const endpointFor = (address: string): string => {
	const trimmed = address.trim().replace(/\/+$/v, "");

	if (trimmed.startsWith(HTTPS_SCHEME)) {
		return `${WSS_SCHEME}${trimmed.slice(HTTPS_SCHEME.length)}${STATUS_STREAM_PATH}`;
	}

	if (trimmed.startsWith(HTTP_SCHEME)) {
		return `${WS_SCHEME}${trimmed.slice(HTTP_SCHEME.length)}${STATUS_STREAM_PATH}`;
	}

	return `${WS_SCHEME}${trimmed}${STATUS_STREAM_PATH}`;
};

interface ButtonWatch {
	readonly address: string;
	readonly onPress: (button: Button) => void;
	readonly log: (message: string) => void;
	// Stops watching, and stops reconnecting. The runner's own shutdown, so
	// that the socket does not hold the process open past Ctrl-C.
	readonly signal: AbortSignal;
}

// Watches the bar's buttons until the signal aborts, reconnecting when the
// stream drops.
//
// Failing to connect is not fatal and is deliberately not thrown. Everything
// else the tool does works over HTTP, and a bar whose buttons cannot be heard
// still draws every alert it would otherwise draw -- so losing this should cost
// acknowledgement and nothing else. What it must not do is fail silently, which
// is why an outage is reported once, and recovery from one is reported too.
const watchButtons = ({ address, onPress, log, signal }: ButtonWatch): void => {
	const endpoint = endpointFor(address);

	let socket: WebSocket | undefined = undefined;
	let reconnecting: NodeJS.Timeout | undefined = undefined;

	// Undefined until the first attempt has settled, so that the first outcome
	// is always worth a line whichever way it goes.
	let healthy: boolean | undefined = undefined;

	const report = (nowHealthy: boolean, message: string): void => {
		if (healthy === nowHealthy) {
			return;
		}

		healthy = nowHealthy;
		log(message);
	};

	// Constructing the socket is itself a thing that can throw: an address the
	// URL parser refuses -- `10.0.4.20 ` with a stray space in it, say -- fails
	// here rather than on the wire, and does it synchronously.
	const open = (): WebSocket | undefined => {
		try {
			return new WebSocket(endpoint);
		} catch (error) {
			report(false, `cannot listen for button presses: ${describe(error)}`);

			return undefined;
		}
	};

	const connect = (): void => {
		// Retried like any other failure to connect. A refused address will not
		// come right on its own -- it is read from a file, once -- but a stream
		// that gave up silently is the thing this function exists to avoid, and
		// the report says so once rather than on every attempt.
		const opening = open();

		if (opening === undefined) {
			reconnecting = setTimeout(connect, RECONNECT_DELAY_MS);

			return;
		}

		socket = opening;
		opening.binaryType = "arraybuffer";

		opening.addEventListener("open", () => {
			report(true, "listening for button presses");
			opening.send(ENABLE_STREAMING);
		});

		opening.addEventListener("message", ({ data }: MessageEvent) => {
			// The state itself is binary. The device says nothing in text, so
			// anything that arrives as text is not a state message.
			if (!(data instanceof ArrayBuffer)) {
				return;
			}

			try {
				for (const button of pressesIn(new Uint8Array(data))) {
					onPress(button);
				}
			} catch (error) {
				// One message this cannot read is not a reason to stop reading
				// them. It would mean the firmware had moved the field this
				// walks, which is worth saying and is not worth taking
				// acknowledgement down over.
				log(`could not read a device state message: ${describe(error)}`);
			}
		});

		// An error is always followed by a close, so the reconnect is arranged
		// in one place rather than in both.
		opening.addEventListener("close", () => {
			if (signal.aborted) {
				return;
			}

			report(false, "not listening for button presses; retrying");
			reconnecting = setTimeout(connect, RECONNECT_DELAY_MS);
		});

		opening.addEventListener("error", () => {
			// Reported by the close that follows. Listened for anyway, because
			// an unhandled `error` event on an EventTarget is not the quiet
			// thing it looks like.
		});
	};

	signal.addEventListener("abort", () => {
		clearTimeout(reconnecting);
		socket?.close();
	});

	connect();
};

export { endpointFor, watchButtons };
export type { ButtonWatch };
