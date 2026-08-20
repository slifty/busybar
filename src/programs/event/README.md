# `event`

The `event` program watches your appointment calendars and interrupts you
before one starts: the name across the full width, and how long until it
underneath, inside a thick yellow frame. The rest of the time it draws nothing
at all.

```
╔══════════════════════════════════╗
║                                  ║
║            TEST Standup          ║
║             in 04:59             ║
║                                  ║
╚══════════════════════════════════╝
```

It is meant to run alongside [`focus`](../focus/README.md), and the two divide
the day between them: `focus` says what you should be thinking about now, and
`event` says what you are about to be late for.

## The layout

Two stacked rows inside a two-pixel frame, and deliberately not how `focus`
draws a block. A block is a thing you are inside, so it sets the name and the
clock side by side and gives the clock a permanent column. An appointment has
not happened yet, so the name is the whole message and the time is a caption on
it.

The frame is two pixels because it is an interruption; `focus` wears a
hairline. Square corners on both, because the device's `radius` thickens a thin
outline's corners before it rounds them.

### Where the sixteen rows go

Every row is spoken for, and the order they were claimed in is the order of
what could not move:

| Rows  | What                                                    |
| ----- | ------------------------------------------------------- |
| 0–1   | Frame                                                   |
| 2     | Padding                                                 |
| 3–6   | The name — four rows, `tiny`                            |
| 7     | Gap, lent to the name's descenders                      |
| 8–12  | The caption — `in` and the digits, on a shared baseline |
| 13    | Padding                                                 |
| 14–15 | Frame                                                   |

**The digits are the immovable part.** The device draws that face and offers no
font for it, so it is five rows whatever else happens, and everything else is
measured from it rather than the other way round.

That is what makes the padding expensive. A two-pixel frame leaves twelve rows;
a clear row top and bottom leaves ten; the digits take five of those; the gap
takes one. The name gets the four that remain, which is `tiny`.

Four rather than five was measured, and the alternative was worse. Five rows is
enough for `small` **only when the name has no descender** — so `TEST no tail`
would set a size larger than `TEST Standup` beside it, two alerts a minute
apart in different fonts. A name that is uniformly small reads as a decision;
one that changes size with its own spelling reads as a fault.

The visible cost is that a longer title is cut: `TEST Located 13:15` sets whole
at six rows and comes out `TEST Located...` at four. It ends in an ellipsis
rather than simply stopping, so the bar says there was more.

Three further details were settled by drawing them and reading the pixels back
with [`tools/preview-event.ts`](../../../tools/preview-event.ts):

- **The caption is `in`, not `Starts in`.** The words are not the message — the
  name is, and the digits are what you look at. Two letters are enough to stop
  the clock being read as how long the thing lasts, which is what the same
  shape means in `focus`.
- **The word and the digits share a baseline, not a top.** They are different
  heights — five rows of digits against four of `tiny` — so aligning their tops
  would sit the word a row high. Each is derived from the baseline separately,
  so changing either font cannot silently knock the two apart.
- **The gap row is lent to descenders.** Without it there is no slack to centre
  in, and a name with a tail sits a row above one without — `TEST` came back on
  rows 3–7 and `TEST Standup` on 2–7 until the row was lent. It is not counted
  when choosing the font, or every tailed name would hang into the gap.

## Appointments are about their start

This is the whole design, and it is what makes this a separate program rather
than a setting on `focus`.

A focus block is about its span — what it is, and how much of it is left. An
appointment is about one instant. Being on time is the entire job, and once the
thing has started the bar has nothing useful left to say about it: you are
either there or you are not, and a bar telling you so is a bar in your way.

So an appointment carries no end. An entry whose end is its start, or which
never says when it stops, is an ordinary appointment here — `focus` drops those,
correctly, because there is nothing to count down. That divergence is why the
two programs map calendar entries separately even though they read them with
the same code.

## How much warning

How you get somewhere is what decides how much warning it is worth, and the
numbers are about travel rather than importance:

| The calendar says   | Default warning | Why                                           |
| ------------------- | --------------- | --------------------------------------------- |
| A physical location | 30 minutes      | Long enough to get there                      |
| A URL               | 5 minutes       | Long enough to finish a sentence and click it |
| Neither             | 5 minutes       | Treated as a link — see below                 |

Those are defaults rather than the rule. `leads` in the config file sets each of
the three, in minutes, because how far away your meetings are is a fact about
your day rather than about this tool — somebody whose appointments are all in
the next room wants a minute, and somebody with a commute to one wants half an
hour. The reasoning above is what the numbers mean, not an argument you have to
accept.

A link is read from `URL`, `CONFERENCE`, or `X-GOOGLE-CONFERENCE`, whichever is
set first. The last of those is what Google Calendar actually writes for a Meet
link and is the one that turns up most.

Two judgements are worth stating because a calendar will exercise both daily:

- **A location that is itself a link is not a place.** Calendars routinely put
  a video call URL in the `LOCATION` field, and reading that as somewhere to
  travel to would give every call taken at your desk half an hour of warning.
  Any URI scheme counts, not only `http` — `zoommtg:`, `msteams:` and `tel:`
  are all things you join from wherever you are sitting. A one-character
  scheme is the exception and stays a place, because the only thing that
  produces one is a path like `C:\rooms\4`. Where the two readings are close,
  this errs towards a place: warning too early costs you twenty-five minutes
  of knowing, and warning too late costs you the meeting.
- **A room wins over a link when an entry has both**, which is ordinary for a
  meeting that is in a room and also dialled into. Travel is the binding
  constraint: warned thirty minutes out you can still take the call from your
  desk, whereas warned five minutes out you cannot be in the room. The cost of
  guessing wrong is asymmetric, so the guess goes the cheaper way.

An entry with nothing written either way is treated as a link rather than as a
place. Something with nowhere on it is far more often at your desk than across
town, and while being warned five minutes out for a journey is the worse
failure, guessing "place" would inflict it on every unlabelled entry in the
calendar.

## Interrupting

`event` draws at priority 91, which is one above an active BUSY or CUSTOM work
session and makes it the loudest thing this tool has.

That is warranted by what the program is rather than by what it is about. An
alert is brief — five minutes, or thirty — and occasional, and it exists
precisely to interrupt; a program that speaks rarely and briefly is the one
case where outranking everything is not simply replacing it.

The cost is real and worth saying plainly: **a focus session you started is
interrupted by a meeting alert.** That is the intended direction. A focus
session does not make the meeting go away, and a bar being tactful about it is a
bar letting you miss it.

## The sound

Thirty seconds before the start, an appointment **with no physical location**
starts chiming: the firmware's own `calendar_event_starts.snd`, replayed every
ten seconds until it is acknowledged.

Only those. Something across town is missed half an hour before it starts, and
no chime thirty seconds out was ever going to save it — whereas a call you are
meant to be on is missed by exactly the thirty seconds you spent not noticing,
which is the failure this is for. So the sound is for `url` and `plain` entries
and never for `located` ones, which is the same split as "did the calendar name
a place".

Four and a half of the five minutes are silent. Looking at a yellow frame is
enough until it is not, and a bar that chimed for the whole lead would be a bar
you turn down.

The chime is replayed rather than played once because it is under two seconds
long and the alert is meant to keep asking. Ten seconds apart leaves a clear gap
between chimes, which is what makes it read as an alarm wanting an answer rather
than as a siren — and each repeat costs a draw, which costs a read of every
calendar, so it is deliberately not faster.

## How an alert ends

Three ways, and the ordinary one is that it expires. Every element is drawn with
the alert's end as its `display_until`, so the device takes it down itself, on
time, and the built-in clock comes back on its own. A process that dies
mid-alert cannot leave one stranded on the display.

When the alert ends depends on whether it makes a noise:

| Alert                | Ends                                             |
| -------------------- | ------------------------------------------------ |
| Somewhere to be      | At the appointment's start                       |
| Anything that chimes | Two minutes after the start, unless acknowledged |

A silent alert's whole job is getting you there on time, which is over once it
is time — so the countdown reaching zero and the alert disappearing are the same
instant. One that chimes has to outlast the start, because it is supposed to
continue until somebody says they have seen it, and the screen going quiet while
the bar is still shouting would be the bar contradicting itself.

Past the start the clock is replaced by the word **`NOW`**. The device clamps the
digits at `00:00` rather than counting negative, which is right as far as it
goes — but a clock reading zero looks like a timer that has _finished_, which is
the wrong impression for the one moment the bar is trying to say you are late. A
word says it without arithmetic, and only an alert that outlasts its start ever
shows it: one with somewhere to be has already gone.

**The frame blinks while this lasts**, half a second lit and half a second dark.
The frame rather than the whole alert, and rather than the word: a name and a
`NOW` that came and went would be a message you have to wait to read, which is
the opposite of what an alert is for. Everything stays legible the entire time
and only the border moves — and the border is already the part doing the
interrupting, so it is the part there is left to escalate.

That costs a draw twice a second for as long as it goes on, which is bounded by
`sound.linger` and is the most urgent state the tool has. It also means the
chime can no longer ride on the draw loop: it used to play once per draw, which
gave a ten-second repeat only because the draws happened to be ten seconds
apart, and would now be two solid minutes of noise. What the alert repeats and
what the screen repeats are tracked separately.

`NOW` is set in `small`, which is exactly the five rows the digits gave back, so
nothing above it moves. The countdown is parked off the left of the display
rather than left out of the draw — an element id outlives the drawing that
stopped using it, and a countdown has no blank to send the way a text element
has a single space. Clearing the application instead would blink the whole alert
off and on at the moment it most wants to be read.

One case does not wait for the expiry: an alert whose appointment has stopped
being one. If the meeting is cancelled, moved, or the calendar simply stops
mentioning it, the next draw takes the alert down itself — the device knows
nothing about the calendar, so its expiry would leave a yellow frame up for a
meeting that is not happening.

**The time box is the third way, and it exists because an unattended bar
acknowledges nothing.** Without a limit, one appointment nobody was there for
leaves the bar chiming until somebody comes back to the desk, which is a worse
thing to walk in on than a missed meeting. Two minutes is long enough to reach
the bar from the next room and short enough that a bar left alone falls quiet
before anybody minds. `sound.linger` moves it, and `0` makes a chiming alert end
at the start like a silent one.

## Acknowledging it

**Press any of the bar's three buttons and the alert is answered:** the sound
stops, the alert comes off the screen, and neither comes back for that
appointment.

Any of them, deliberately. The bar has three buttons and this program has one
thing to say, and a rule about which one counts is a rule you have to remember
at the exact moment you are late for something.

It answers whatever is on screen, chiming or not. Acknowledgement was asked for
so that a noise could be stopped, but a bar that only takes an answer while it
is making a noise is a bar with a rule nobody was told — the yellow frame is the
same interruption either way.

Acknowledging is about one alert rather than about the day. The next appointment
gets its own interruption, and a meeting moved to a different time is a
different alert.

It is remembered in memory and nowhere else. Acknowledgement is a fact about the
last few minutes, and a process that has restarted was not there when the button
was pressed.

### Getting a press into a Node process

This is the one part of the tool that does not talk HTTP, and it is worth
knowing why, because the HTTP API looks like it should be enough and is not:

- **`POST /api/input` is the wrong direction.** It sends a keypress _to_ the
  bar. Nothing reports one coming back, and no `/api/status` endpoint carries the
  buttons.
- **The device's state stream does carry them**, as
  `BSB_State.StateUpdate.input` on the WebSocket at `/api/status/ws`.
- **`busy-lib` cannot read that stream from Node.** Its `StateStream` runs in a
  `SharedWorker`, which is browser-only.

The protocol underneath is not browser-only, though. A plain `WebSocket`
connects, `{"enable": true}` starts the flow, and the four fields a press
occupies decode without a protobuf runtime — which is what
[`src/input/`](../../input/) does. The runner owns one connection for the whole
process and opens it only if some program declares `onButton`, so a run with no
program listening never opens a socket at all.

The cost of this is stated rather than hidden: the alert's screen and sound need
only HTTP, and acknowledgement needs the socket. A bar whose buttons cannot be
heard still draws and chimes exactly as it would otherwise — it just cannot be
answered, and falls back to the time box.

**The socket is not a USB-only thing.** It is the same HTTP server as everything
else, on the same routes, behind the same access gate: with `/api/access` set to
`disabled` the Wi-Fi address answers 403 to the WebSocket upgrade and to every
other request alike, and over USB it answers 101 and 200. So the stream follows
whatever transport the rest of the tool is on. What is missing for a bar reached
over the network is a credential rather than a capability — see the device notes
in [`AGENTS.md`](../../../AGENTS.md). The one place this does not hold is the
cloud proxy, whose stream is JSON rather than protobuf and which this decoder
would not read.

## Handing the screen back

Whenever an alert stops — answered, expired, or timed out — this program tells
the runner it has let the display go, and every other program draws again.

That is not politeness. The device **destroys** the elements underneath a
higher-priority draw rather than covering them, and never restores them, so an
alert that came and went leaves the bar blank rather than back where it was.
`focus` cannot notice: its own draw succeeded, and it will not draw again until
the next phase change, which mid-block can be hours off. Measured on the bar,
not reasoned about — an application drawing at 50, interrupted at 91, is gone
the moment the interruption clears.

## When two alerts overlap

Overlapping alerts are ordinary rather than a conflict, and this is where
`event` differs sharply from `focus`. Two focus blocks cannot both be what you
are doing, so `focus` discards one of any overlapping pair outright. Two
appointments can perfectly well both be coming up and neither is wrong — a two
o'clock across town starts warning at half past one, and a half past one call
starts warning at twenty-five past.

What has to be decided is only which of them owns 72×16 pixels, and the answer
is **whichever starts soonest**. At twenty-five past, the call is the thing you
are about to miss. Sorting by start rather than by which alert spoke first is
what lets the more urgent one take the screen from the longer one, and hand it
back once it has begun. Exact ties go to whichever was read first.

## The calendars

Any number of them, as `https` URLs or paths to `.ics` files:

```yaml
programs:
  event:
    calendars:
      # work
      - https://calendar.google.com/calendar/ical/…/basic.ics
      - https://calendar.google.com/calendar/ical/…/basic.ics
      # personal
      - local/personal.ics
```

They are read at once rather than in turn — they are independent, and reading
four in sequence would spend four timeouts' worth of a draw waiting on the
slowest — and what comes back is pooled. Which feed an appointment arrived on
stops mattering the moment it is read, which is why the list is a list rather
than a block of named entries: the names would have to be unique, since YAML
rejects a repeated key, and they would buy nothing. A comment groups them for
whoever is reading the file.

**One feed failing fails the read**, and the red `ERROR` goes on the bar. That
matters more here than it would elsewhere: carrying on with three calendars out
of four means a bar that is confidently silent about a meeting it simply never
saw, and silence is exactly what this program looks like when it is working.

A program watching no calendars at all is refused at startup rather than run,
for the same reason — it is indistinguishable from a working one, and an
`event:` block somebody has yet to fill in is far more often a mistake than a
request.

In Google Calendar the URL is **Secret address in iCal format**, on the settings
page of the calendar itself. It is a credential — anyone holding it can read the
calendar — so it belongs in `local/config.yml`, which is git-ignored.

Four kinds of entry are skipped rather than drawn, quietly, because a calendar
is not written for this tool and one odd entry should not take the rest down:

| Skipped                           | Why                                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| All-day events                    | No instant to be on time for — a label for the day rather than something you can be late to                                       |
| Events the calendar has cancelled | The calendar already says they are off                                                                                            |
| Titles with nothing drawable      | The name is the whole of what the alert says, and a yellow box that names nothing is an interruption declining to give its reason |
| Anything more than two days off   | Only what falls near now is read                                                                                                  |

## Keeping up

The calendars are read on a clock of their own, every five minutes by default,
and **nothing about drawing is involved**. `draw` uses whatever was last read
and fetches nothing.

Those are two different questions and used to be one. Drawing is about the next
few seconds and happens when something on screen has to change; reading is about
the next few hours and should happen whether or not anything is on screen at
all. Tying them together meant a program with nothing to show had to be woken on
a timer purely to look at a feed, and a program chiming every ten seconds
re-fetched every calendar every ten seconds to redraw pixels it had already
drawn.

So the program now asks for no draws at all on a day with nothing left in it,
and the refresher wakes it if that stops being true. **`refresh` is the longest a
meeting entered on your phone can take to reach the bar** — and since an alert
with no physical location only opens five minutes before the start, an
appointment created less than `refresh` plus its lead before it begins can be
missed entirely. Somewhere-to-be entries have half an hour of lead and absorb it
comfortably.

Shortening it is not free. A read is a fetch of every feed in full, and a
Google calendar answers that with a year of history whether or not anything in
it has changed, so the interval is what stops a program that draws nothing all
morning from being the noisiest thing on the network.

A feed that answers badly is asked again before it is given up on: four more
attempts, waiting 15 seconds, then 30, then a minute, then two. A 5xx and a
request that never arrived are both retried; a 4xx is not, because a wrong
address or a rotated key will say the same thing however many times it is
asked. Google’s iCalendar export answering `500` to a request it served a
minute earlier is the case this exists for, and it never reaches the bar.

A read that fails all of that is not swallowed. The reason is kept and logged,
and once what was last read has gone stale the next draw throws it, so the red
`ERROR` goes on the bar — which matters more here than elsewhere, because a bar
quietly showing nothing is exactly what this program looks like when it is
working.

**Stale is `stale` hours since the last read that worked, 24 by default.** A
failed read keeps the appointments the last good one found, so the question is
how long those are still worth drawing. “I could not read the calendar just
now” and “I have not read the calendar since yesterday” are different facts and
only the second is worth the screen: covering a current schedule with an error
would take the display away from the meeting the alert was put there for. A
feed that cannot be read at _startup_ is the exception and still refuses to
start, since there is nothing in hand to draw instead.

While an alert is up, the draws are about the alert alone: when it is due to
chime, when a sooner appointment's window opens, and when it ends.

## Settings

| Setting         | Default | What it does                                                                               |
| --------------- | ------- | ------------------------------------------------------------------------------------------ |
| `calendars`     | —       | The appointment calendars to watch: `https` URLs or `.ics` paths. At least one is required |
| `leads.located` | `30`    | Minutes of warning for an appointment with somewhere physical to be                        |
| `leads.url`     | `5`     | Minutes of warning for one with a link                                                     |
| `leads.plain`   | `5`     | Minutes of warning for one that says neither                                               |
| `sound.lead`    | `30`    | Seconds before the start that an alert with no physical location starts chiming            |
| `sound.linger`  | `120`   | Seconds past the start it keeps chiming unacknowledged. `0` ends it at the start           |
| `refresh`       | `5`     | Minutes between reads of the calendars, independent of drawing entirely                    |
| `stale`         | `24`    | Hours since the last successful read before a failure to read is drawn rather than logged  |

An alert is always on screen by the time it chimes, whatever the two blocks say.
Nothing stops `leads.url` being shorter than `sound.lead`, and a bar chiming
about an appointment it is not naming is alarming and useless in the same
breath.

---

[← All programs](../../../README.md#programs)
