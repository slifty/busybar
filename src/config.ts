// Configuration for the hello world greeting.
//
// The address is the fixed USB-Ethernet address of a BUSY Bar plugged into
// this machine; it is printed on the back cover of the device. Reaching a bar
// over Wi-Fi or the BUSY cloud proxy needs credentials as well, so that is
// deliberately out of scope here.

const DEVICE_ADDRESS = "10.0.4.20";

// Identifies our drawings to the device. Elements are namespaced by app, so
// clearing this app leaves anything drawn by other apps alone.
const APPLICATION_NAME = "hello_world";

// Draw priority, in the range [1, 100]. A draw is accepted when its priority
// is greater than or equal to that of the app currently on screen: built-in
// apps sit at 10, an active BUSY or CUSTOM work session at 90. The API's
// default of 50 therefore draws over the clock but yields to a focus session,
// which is the behaviour we want.
const DRAW_PRIORITY = 50;

// The front display is 72x16.
const FRONT_DISPLAY_WIDTH = 72;
const FRONT_DISPLAY_MIDDLE_Y = 8;

const GREETING_TEXT = "Hello, World!";

// `extra_large` is wide enough that the greeting overflows 72px, which is what
// makes it scroll. It is also an uppercase-only face, so the text renders as
// "HELLO, WORLD!" regardless of how it is written here.
const GREETING_FONT = "extra_large";
const GREETING_COLOR = "#33CCFFFF";

// Scroll rate is pixels per minute, not per second.
const SCROLL_RATE_PX_PER_MINUTE = 1_200;
const SCROLL_START_DELAY_MS = 1_000;
const SCROLL_REPEAT_DELAY_MS = 2_000;

export {
	APPLICATION_NAME,
	DEVICE_ADDRESS,
	DRAW_PRIORITY,
	FRONT_DISPLAY_MIDDLE_Y,
	FRONT_DISPLAY_WIDTH,
	GREETING_COLOR,
	GREETING_FONT,
	GREETING_TEXT,
	SCROLL_RATE_PX_PER_MINUTE,
	SCROLL_REPEAT_DELAY_MS,
	SCROLL_START_DELAY_MS,
};
