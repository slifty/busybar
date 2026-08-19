# `focus`

The `focus` program turns the bar into a view of the focus block you are
currently in: what you are doing on the left, and how long is left of it on the
right — counting down, and running out along a line underneath — inside a
coloured frame. Between blocks the bar shows nothing and the built-in clock has
the screen back.

```
┌───────────────────────────────────┐
│                         0:44:59   │
│      Deep Work                    │
│                         ░░▮████   │
└───────────────────────────────────┘
```

The colour says where you are in the block:

| Colour | When                                     |
| ------ | ---------------------------------------- |
| Blue   | The first 15 minutes — settling in       |
| Green  | The middle                               |
| Orange | The last 15 minutes — time to wrap it up |

The colour is the frame and the clock; the name itself is always white. A phase
colour on the text would dim the one thing you are trying to read — orange
lettering at wind-down worst of all — whereas a frame changing colour is
visible from further away than the words are, and costs the words nothing.

The clock takes 27px and the name gets the remaining 37px. That is the
countdown's real width rather than a proportion picked by eye: the device draws
it in a fixed monospaced face, 17px as `MM:SS` and 27px once the hours appear.

The hours are asked for on every block, even when the answer is zero — so the
clock reads `0:44:59` rather than `44:59`. Left to itself the device drops the
hours an hour from the end, which changes the clock's width and hands the name
ten pixels back mid-block. That would mean any block over an hour is drawn one
way and then drawn another way an hour from its end, with the bar under it
moving too, at an instant our clock and the device's have to agree on to the
tick. Sizing everything for the wide clock costs the name those ten pixels
always and makes the display one thing rather than two: nothing moves, and what
you look at is what was tested.

A block shorter than half an hour qualifies for both ends at once. Orange wins
there, on the grounds that being told to wrap up is worth more than being told
you have just started, so a twenty-minute block reads blue for five minutes and
orange for fifteen.

## The progress line

Under the clock is a line of where you are in the block, one pixel deep and
drawn the whole width of the clock. The whole of it is always drawn: the line
is the block from end to end, and where you are in it is a change of brightness
rather than a change of length.

| Segment                | Drawn as                      |
| ---------------------- | ----------------------------- |
| The part already spent | White at 25% brightness       |
| Now                    | One pixel of the phase colour |
| The part still to come | White                         |

So the ink is always the time you still have, the dim end is what you have
spent, and the coloured pixel between them walks the length of the line as the
block runs.

The line and the clock say the same thing and answer different questions.
`0:44:59` is exact and says nothing about whether that is most of the block or
the tail of it — which is usually what you are asking when you glance up, and
the one thing a countdown cannot answer, since it does not know when the block
began. Two hours left of a two-hour block and two hours left of a working day
read identically on a clock.

The spent end is dim rather than dark because it is still saying something: it
is what makes the line's left end visible, and so what the lit part is a
proportion of. Turned right off, a block just begun and a block half over would
both be a stretch of ink with nothing to measure it against.

Now is a single pixel, and the only place on the line the phase colour appears
— which is what makes it findable at a glance rather than something you have to
measure the line to locate.

The three are drawn as three rectangles lying on top of one another rather than
end to end, sent in the order they are meant to be seen in: the whole line dim,
the part still to come over the right of it, and now over the pixel where the
two meet. Laid end to end, each would be a length that reaches zero — no time
spent at the start of a block, none left at the end — and an element of no
width is a thing this device has never been asked for. Overlapping, every one
of them is a rectangle with something in it at every moment of every block.

The line is exactly the clock's width and sits directly under it. Since the
clock is one width always, so is the line, and neither of them ever moves.

It sits one clear row under the digits, with everything left over falling
between it and the display's frame — with the clock rather than centred in the
space below it, because it belongs to the clock. It must touch neither
neighbour. Digits resting on the line would read as underlined, which is the
one thing it must not look like, and the frame is a solid line in the phase
colour — the colour of the pixel marking now — so the two merging would put a
false now at the bottom of the display. Of the two the frame is worth the extra
distance, the digits above being broken and mostly white.

The text — the name as well as the clock — is lifted a row from where even
padding would put it, which is what makes room for all of that. It costs a
pixel of headroom on the tallest names, at the top of the display where there
is nothing to collide with.

Within that lifted band the clock is centred on its own ink as though the line
were not there. Centring the two together as one block would move the clock off
the line the name is centred on, to make room for what is a second opinion
about the same quantity — and a second opinion does not get to move the first.

Twenty-seven pixels is all the resolution there is, so the lit part gives up a
pixel at a time and the program comes back at the twenty-seven instants a pixel
is actually due — the one part of the drawing the device cannot keep for
itself. The last pixel stays lit until the block is genuinely over, since a
line that went dark while the clock beside it still read `0:00:20` would be
wrong about the only thing it is there to say.

## The schedule

Blocks come from a calendar, or from a JSON file when no calendar is set.
Whichever it is, it is the only part of the program that knows where blocks
come from: everything above it — resolving overlaps, picking the current block,
colouring it, drawing it — is written against a schedule rather than against a
source.

### From a calendar

Point `programs.focus.calendar` at an iCalendar feed, as either an `https` URL
or a path to an `.ics` file:

```yaml
programs:
  focus:
    calendar: https://calendar.google.com/calendar/ical/…/basic.ics
    # calendar: local/focus.ics
```

The two are told apart by parsing the value as a URL rather than by looking for
a slash or a dot, so `local/focus.ics` stays a path and anything with an `http`
or `https` scheme is fetched. A URL is fetched afresh on each read, with a ten
second timeout.

In Google Calendar both come from the settings page of the calendar itself:
**Secret address in iCal format** is the URL, and **Export calendar** downloads
a zip with an `.ics` inside it. Prefer the URL. A downloaded file is a snapshot
and goes stale the same way a hand-written schedule does, which is the whole
problem a calendar is meant to solve. The secret address is a credential —
anyone holding it can read the calendar — so it belongs in `local/config.yml`,
which is git-ignored, rather than anywhere committed.

One calendar is read, and every event in it is treated as a focus block. That
is what makes a calendar kept for this purpose work and a general-purpose one
not: a calendar with your dentist in it will put your dentist on the bar.

Recurring events are expanded properly, which means the parts that make
recurrence real rather than nominal: an occurrence you dragged to a different
time comes back moved, one you renamed comes back renamed, and one you deleted
does not come back. Times written in a named timezone are resolved against the
calendar's own definition of that zone, so a feed from a machine in another
timezone lands at the right hour rather than being read as UTC.

Four kinds of event are skipped rather than drawn, quietly, because a calendar
is not written for this tool and one odd entry in it should not take the whole
schedule down:

| Skipped                                | Why                                                                                                                |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| All-day events                         | They run midnight to midnight, and by the overlap rule below a single one would suppress every real block that day |
| Events the calendar has cancelled      | The calendar already says they are off                                                                             |
| Events ending no later than they start | Nothing to count down to                                                                                           |
| Titles with nothing drawable           | A name is the whole of what a block says, and a blank row says nothing                                             |

Only what falls near now is read — from a day back to two days ahead. The
lookback exists to catch a block that started before now and is still running;
the horizon is what a recurring event has to be expanded up to, since a rule
with no end describes infinitely many occurrences.

### From a file

Without a calendar, blocks are read from a JSON file — `local/focus.json`, or
wherever `programs.focus.file` points. `local/` is git-ignored wholesale, since a
schedule of what you are doing all day belongs to one machine rather than to the
repository:

```json
[
	{
		"name": "Deep Work",
		"start": "2026-08-07T09:00:00Z",
		"end": "2026-08-07T10:30:00Z"
	}
]
```

It predates the calendar reader and stays because a schedule you can type in a
text editor is the fastest way to try something without exporting anything. It
is stricter than the calendar: a block it cannot make sense of stops the tool
rather than being skipped, because a file you wrote yourself getting something
wrong is a mistake worth hearing about.

### The file when a calendar is set

Setting a calendar turns this file around: it is written on every start rather
than read, with whatever the calendar said.

Nothing reads it while a calendar is set, so it is not a cache — it is there to
be looked at. A schedule file is the first thing anyone opens to answer "what
is the bar working from?", and one left saying something the bar stopped
showing weeks ago answers it wrongly and convincingly. Keeping it current costs
one write per start and removes a way to be misled.

What lands in it is what the bar will draw, not what the calendar holds: names
already reduced to what the fonts can render, all-day and cancelled events
already dropped, and only the blocks near enough to now to matter. So unsetting
the calendar leaves a working schedule behind rather than an empty file — which
is also the way to go back to editing it by hand, since a start with a calendar
set will otherwise overwrite whatever you typed.

If the file cannot be written — a directory that is not there, a permission
that is not given — the tool says so and carries on. It reads the calendar
directly and does not need this file to work.

### Overlaps

Overlapping blocks are neither merged nor trimmed. The one that starts earlier
wins and the other is ignored outright, with ties settled by the order they were
read in. Blocks that merely touch both survive, since a block is half-open: one
ending at 10:00 has released the screen before one starting at 10:00 claims it.

Names are drawn as text, and the device's fonts are bitmap ASCII, so anything
outside printable ASCII — em dashes, curly quotes, emoji — is dropped from a
name before it is drawn. A name left with nothing drawable at all is an error
rather than a blank row.

### Names that do not fit

A name is never scrolled. Scrolling turns a thing you glance at into a thing
you wait for, and it is undone by every redraw besides, since the animation
starts again from the beginning.

Instead the name is sized to the space it has. Every font the device ships was
measured — how wide each character comes out, and which rows its ink occupies —
so the program can pick the largest one the name fits in, break it across two
lines at a space when one line will not do, and centre what it ends up with on
the ink it actually has rather than on the font's nominal height. A short name
gets a large one; a long one gets smaller type and a second line.

A name too long for even that is cut at a space and ends in an ellipsis, so the
bar says that there was more rather than quietly showing you part of something.

A schedule that is missing or malformed at startup stops the tool with the
reason. The alternative is a bar that sits dark all day while the explanation
scrolls past in a log. Once running, the same problem is only a failed draw,
retried on the runner's short delay — the source belongs to whatever is writing
it, so finding it mid-write, or finding the network down, is a moment to wait
out rather than to exit on. It is also drawn on the bar; see
[When something goes wrong](../../../README.md#when-something-goes-wrong).

## Keeping up with a source that changes

Blocks are timestamps, not times of day, so a schedule is only ever about the
days it actually names. That makes the schedule something to keep current rather
than to write once, and the program is built to be read from while something
else is writing to it.

The schedule is read on every draw, not held from startup. A process left
running overnight therefore picks up a new day's blocks on its own, and a block
added, moved, or cancelled during the day takes effect at the next draw without
a restart. With a calendar URL that is the whole of the sync: there is no cache
and no separate process, because a read costs one request a handful of times a
day.

Between blocks, the program will not go more than fifteen minutes without
looking at the file again, even when the next block it can see is hours off —
otherwise a block added ahead of that one would be missed, and a schedule that
had run out would never be looked at again. Nothing is on screen at those
moments, so the wake-up costs a file read and no device traffic.

That cap deliberately does not apply while a block is showing. A change to a
block already on screen is picked up at the next draw the block was having
anyway — a colour change, or a pixel of the progress line — rather than
immediately, since
waking up more often to find nothing has changed is traffic spent on nothing.

An exhausted schedule is treated as one that has not been filled in yet, since
that is what it usually is. The program keeps checking rather than stopping,
which is what lets a sync that has not run yet, or a file written later in the
day, still reach the bar.

## What the device does for itself

Two properties of the hardware keep a block to a handful of requests:

- **The countdown is a device-side element.** It takes the block's end as a
  Unix timestamp and ticks down by itself, so nothing has to redraw it to keep
  the time honest.
- **Elements are given an expiry rather than a timeout.** They carry the
  block's end as `display_until`, so the device takes them down on time and
  releases the screen on its own — even if this process is not around to do it.
  The countdown reaching zero and the drawing disappearing are the same moment.

What is left is around thirty draws for a typical block: one when it starts,
one when it turns green, one when it turns orange, and one for each of the
twenty-seven pixels the progress line gives up on its way out. The program asks to
be woken at exactly those moments rather than polling to find them, because a
poll would be a request every few seconds to redraw something that had not
changed. Nothing about the layout is on that list — with the clock at a fixed
width there is no moment at which what is on screen has to be rearranged.

## Settings

| Setting    | Default            | What it does                                                          |
| ---------- | ------------------ | --------------------------------------------------------------------- |
| `calendar` | —                  | An iCalendar feed to read blocks from: an `https` URL or `.ics` path  |
| `file`     | `local/focus.json` | Where the schedule is read from, or written to when a calendar is set |

---

[← All programs](../../../README.md#programs)
