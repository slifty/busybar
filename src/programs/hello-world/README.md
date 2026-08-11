# `hello-world`

The default program scrolls "Hello, World!" across the front display and leaves
it there until you stop it with Ctrl-C.

Two properties of the device shape how this works:

- **The greeting is drawn once, not on a loop.** Elements normally carry a
  timeout and expire, but a timeout of `0` means the element stays until it is
  cleared. That matters here because redrawing an element restarts its scroll
  animation, so a redraw loop would jerk the text back to the start on every
  tick. Its draw asks for no follow-up.
- **A focus session outranks us.** Draws are priority-ranked, and an active
  BUSY or CUSTOM session sits above the default. The greeting reports that it
  was preempted rather than pretending it drew something.

Because the greeting never expires on its own, the program clears it on the way
out.

## Settings

None.

---

[← All programs](../../../README.md#programs)
