// Core configuration, shared by every program.
//
// The address is the fixed USB-Ethernet address of a BUSY Bar plugged into
// this machine; it is printed on the back cover of the device. Reaching a bar
// over Wi-Fi or the BUSY cloud proxy needs credentials as well, so that is
// deliberately out of scope here.

const DEVICE_ADDRESS = "10.0.4.20";

// Environment variable naming which program to run.
const PROGRAM_ENV_VAR = "BUSYBAR_PROGRAM";

// Draw priority, in the range [1, 100]. Built-in apps sit at 10, an active
// BUSY or CUSTOM work session at 90. The API's default of 50 therefore draws
// over the clock but yields to a focus session, which is the behaviour we
// want.
//
// A draw is accepted when it outranks the application currently holding the
// screen, or when it comes from that same application at the same priority.
//
// This is measured rather than read, because the API schema says the opposite
// -- it claims an equal-priority request from a different application_name
// overrides whatever is on screen, and the firmware answers 409. What the
// device actually does:
//
//   incumbent a@50, then b@50   ->  409
//   incumbent a@50, then a@50   ->  accepted
//   incumbent a@50, then a@49   ->  409
//   incumbent a@50, then a@51   ->  accepted
//   nothing on screen, then b@50 -> accepted
//
// Repainting on a program's own schedule therefore works, and anything else
// this tool wants on screen has to go under the running program's application
// name: a second name of our own would be an application competing with
// itself, and would lose.
const DRAW_PRIORITY = 50;

// The front display is 72x16. The back display is 160x80 and unused so far.
const FRONT_DISPLAY_WIDTH = 72;
const FRONT_DISPLAY_HEIGHT = 16;
const FRONT_DISPLAY_MIDDLE_X = 36;
const FRONT_DISPLAY_MIDDLE_Y = 8;

export {
	DEVICE_ADDRESS,
	DRAW_PRIORITY,
	FRONT_DISPLAY_HEIGHT,
	FRONT_DISPLAY_MIDDLE_X,
	FRONT_DISPLAY_MIDDLE_Y,
	FRONT_DISPLAY_WIDTH,
	PROGRAM_ENV_VAR,
};
