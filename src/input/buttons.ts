import { fieldsOf, messageAt, messagesAt, numberAt } from "./protobuf.ts";

// The bar's own buttons, and how a press of one arrives.
//
// The field numbers and enum values below are the device's, taken from the
// schema `busy-lib` embeds in its state-stream worker (`BSB_State.State`,
// `BSB_State.StateUpdate`, `BSB_Input.*`). They are written out here rather
// than imported because the package does not export them outside that worker.
// Anything that reads them wrong reads a press as the wrong button rather than
// failing, so they are worth checking against the firmware if a press ever
// arrives as something nobody pressed.
const STATE_UPDATES_FIELD = 2;
const UPDATE_INPUT_FIELD = 11;
const INPUT_BUTTON_EVENT_FIELD = 1;
const BUTTON_EVENT_BUTTON_FIELD = 1;
const BUTTON_EVENT_ACTION_FIELD = 2;

// In the order the device numbers them, which is what makes the index the
// wire value.
const BUTTONS = ["ok", "back", "start"] as const;

type Button = (typeof BUTTONS)[number];

// Whether the button was going down or coming back up. Only the first of them
// is a press.
const PRESS = 0;

// What a field holding the first value of its enum comes to when it is absent.
//
// proto3 does not write a field whose value is the zero of its type, so the
// most ordinary press there is -- `ok` going down -- arrives as a button event
// with nothing in it at all. Reading absence as anything but zero would drop
// exactly that press.
const ENUM_DEFAULT = 0;

// The presses in one state message from the device.
//
// A message can carry any number of updates and most carry none of ours: the
// same stream reports wifi, power, brightness and the screen's own frames, and
// this walks past all of it. Releases are walked past too. Nothing this tool
// does distinguishes a long press from a short one, and surfacing both halves
// would have every press acknowledge an alert twice.
const pressesIn = (message: Uint8Array): Button[] => {
	const state = fieldsOf(message);

	return messagesAt(state, STATE_UPDATES_FIELD).flatMap((updateBytes) => {
		const input = messageAt(fieldsOf(updateBytes), UPDATE_INPUT_FIELD);

		if (input === undefined) {
			return [];
		}

		const buttonEvent = messageAt(fieldsOf(input), INPUT_BUTTON_EVENT_FIELD);

		if (buttonEvent === undefined) {
			return [];
		}

		const event = fieldsOf(buttonEvent);
		const action = numberAt(event, BUTTON_EVENT_ACTION_FIELD) ?? ENUM_DEFAULT;

		if (action !== PRESS) {
			return [];
		}

		const which = numberAt(event, BUTTON_EVENT_BUTTON_FIELD) ?? ENUM_DEFAULT;
		const { [which]: button } = BUTTONS;

		// A button this firmware has and this list does not. Skipped rather
		// than guessed at, since the alternative is reporting a press of
		// whichever button happens to sit at that index here.
		return button === undefined ? [] : [button];
	});
};

export { BUTTONS, pressesIn };
export type { Button };
