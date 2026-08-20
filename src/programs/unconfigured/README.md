# `unconfigured`

What the bar shows when nothing has been set to run:

```
┌───────────────────────────────────┐
│        No programs to run.        │
│      Edit local/config.yml        │
└───────────────────────────────────┘
```

It is not in the list of programs and cannot be asked for by name. It is not an
operating mode somebody would choose — it is what is left when nobody has
chosen one, which is an empty `run` list, no `run` list, or no config file at
all.

The alternative is the device's own built-in clock, which is what the bar shows
whenever this tool draws nothing. A first run would then look exactly like a run
that never happened. The greeting that used to be here was no better: a bar
scrolling "Hello, World!" says that the tool works and nothing about what it is
waiting for.

## The file it names

The file is the thing to go and open, and `--config` means the default is not
always the file being read, so the message names the file it was actually
given.

It names it only when it fits. A path is one long unbreakable word and 72
pixels holds about eighteen characters of one, so a long path is what the
fitting would cut — and `Edit /Users/som...` names a file nobody has, at the
cost of the line that could have said what kind of file to look for. So a path
that does not fit is replaced by "the config file" rather than cut, and the
whole of it goes to the log instead:

```
busybar: starting "unconfigured" -- Says that nothing has been set to run
busybar: add a program to the run list in /Users/somebody/elsewhere/other.yml
```

The log gets the name of the list as well, which is the thing to write once the
file is open.

## Settings

None. It is drawn at the ordinary priority, so an active BUSY or CUSTOM session
outranks it — a bar someone is already using is not a bar waiting to be set up.

---

[← Configuration](../../../README.md#configuration)
