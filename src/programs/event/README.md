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

Two ways, and the ordinary one is that it expires. Every element is drawn with
the alert's end as its `display_until`, so the device takes it down itself, on
time, and the built-in clock comes back on its own. A process that dies
mid-alert cannot leave one stranded on the display.

When the alert ends depends on whether it makes a noise:

| Alert                | Ends                        |
| -------------------- | --------------------------- |
| Somewhere to be      | At the appointment's start  |
| Anything that chimes | Two minutes after the start |

A silent alert's whole job is getting you there on time, which is over once it
is time — so the countdown reaching zero and the alert disappearing are the same
instant. One that chimes has to outlast the start, because the screen going
quiet while the bar is still shouting would be the bar contradicting itself.
Past the start the countdown reads `00:00`: the device clamps it rather than
counting negative, which is exactly right — you are late, and by how much is not
the useful number.

**The time box is the second way, and for now it is the only thing that stops a
chime.** The alert was specified to continue until somebody says they have seen
it, and nothing on the bar can say that yet — so a limit is doing the whole job
of ending it, and would still be needed once a button can, because an unattended
bar acknowledges nothing. Two minutes is long enough to reach the bar from the
next room and short enough that a bar left alone falls quiet before anybody
minds. `sound.linger` moves it, and `0` makes a chiming alert end at the start
like a silent one.

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

The calendars are read on every draw, not held from startup, so a meeting added
this morning reaches a process that started yesterday and a cancelled one stops
alerting without a restart.

Between alerts the program will not go more than fifteen minutes without looking
again, even when the next alert it can see is hours off — otherwise a meeting
added ahead of that one would be missed, and a day whose appointments are all
done would never be looked at again. Nothing is on screen at those moments, so
the wake-up costs a read and no device traffic.

While an alert is up, the next draw is whichever comes first of the appointment
starting and a sooner appointment's window opening. The device ticks the
countdown on its own in between, so a typical alert is one draw.

## Settings

| Setting         | Default | What it does                                                                               |
| --------------- | ------- | ------------------------------------------------------------------------------------------ |
| `calendars`     | —       | The appointment calendars to watch: `https` URLs or `.ics` paths. At least one is required |
| `leads.located` | `30`    | Minutes of warning for an appointment with somewhere physical to be                        |
| `leads.url`     | `5`     | Minutes of warning for one with a link                                                     |
| `leads.plain`   | `5`     | Minutes of warning for one that says neither                                               |
| `sound.lead`    | `30`    | Seconds before the start that an alert with no physical location starts chiming            |
| `sound.linger`  | `120`   | Seconds past the start it keeps chiming. `0` ends it at the start                          |

An alert is always on screen by the time it chimes, whatever the two blocks say.
Nothing stops `leads.url` being shorter than `sound.lead`, and a bar chiming
about an appointment it is not naming is alarming and useless in the same
breath.

---

[← All programs](../../../README.md#programs)
