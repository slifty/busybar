import { describe, expect, it } from "vitest";
import { bytesOf, messageField, numberField } from "../../test/protobuf.ts";
import { BUTTONS, pressesIn } from "../buttons.ts";

// The device's own numbering, which is what the decoder is being held to.
const STATE_UPDATES = 2;
const UPDATE_INPUT = 11;
const INPUT_BUTTON_EVENT = 1;
const BUTTON = 1;
const ACTION = 2;

const PRESS = 0;
const RELEASE = 1;

// A field holding the zero of its enum is left off the wire entirely, so both
// of these are optional -- which is the whole reason this suite exists.
const buttonEvent = (button?: number, action?: number): number[] => [
	...(button === undefined ? [] : numberField(BUTTON, button)),
	...(action === undefined ? [] : numberField(ACTION, action)),
];

const input = (event: number[]): number[] =>
	messageField(UPDATE_INPUT, messageField(INPUT_BUTTON_EVENT, event));

const state = (...updates: number[][]): Uint8Array =>
	bytesOf(...updates.map((update) => messageField(STATE_UPDATES, update)));

describe("pressesIn", () => {
	// The most ordinary press there is arrives as a button event with nothing
	// in it at all: `ok` is button zero and `press` is action zero, and proto3
	// writes neither. A reader that needed the fields present would drop it.
	it("reads a press with both of its fields left off the wire", () => {
		expect(pressesIn(state(input(buttonEvent())))).toStrictEqual(["ok"]);
	});

	it.each([
		["back", 1],
		["start", 2],
	])("reads a %s press", (name, value) => {
		expect(pressesIn(state(input(buttonEvent(value))))).toStrictEqual([name]);
	});

	// Nothing this tool does tells a long press from a short one, and reporting
	// both halves would have every press answer an alert twice.
	it("ignores the release that follows a press", () => {
		expect(pressesIn(state(input(buttonEvent(1, RELEASE))))).toStrictEqual([]);
	});

	it("reads a press that says its action outright", () => {
		expect(pressesIn(state(input(buttonEvent(1, PRESS))))).toStrictEqual([
			"back",
		]);
	});

	// The same stream carries wifi, power, brightness and the screen's own
	// frames, and most messages hold none of ours.
	it("finds nothing in a state message about something else", () => {
		expect(pressesIn(state(numberField(5, 1)))).toStrictEqual([]);
	});

	it("finds nothing in a message with no updates at all", () => {
		expect(pressesIn(new Uint8Array())).toStrictEqual([]);
	});

	it("reads every press in a message carrying more than one", () => {
		expect(
			pressesIn(state(input(buttonEvent(1)), input(buttonEvent(2)))),
		).toStrictEqual(["back", "start"]);
	});

	// A button this firmware has and this list does not. Guessing would report
	// a press of whichever button happened to sit at that index.
	it("says nothing about a button it does not know", () => {
		expect(pressesIn(state(input(buttonEvent(BUTTONS.length))))).toStrictEqual(
			[],
		);
	});
});
