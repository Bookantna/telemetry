# F1 25 Telemetry

A personal app that turns the data F1 25 sends while you drive into a live dashboard on a tablet beside your wheel, and saves every lap for comparing later.

## Language

### From the game

**Telemetry Feed**:
The stream of UDP packets F1 25 sends while you drive, and the app's only source of data.
_Avoid_: telemetry (on its own), data stream, UDP data

**UDP Format**:
Which version of the Telemetry Feed's layout the game is set to send: 2025 (the original) or 2026 (added by the 2026 Season Pack). It is chosen in the game's telemetry settings.
_Avoid_: packet version (a different per-packet field), spec year, game version

**Player Car**:
The car you are driving. The game identifies it in every packet of the Telemetry Feed.
_Avoid_: my car, own car, ego car

**Flashback**:
The game's feature that rewinds time during a session so you can redo part of a lap.
_Avoid_: rewind, undo

### What the app passes on

**Forwarding**:
The app sending an unchanged copy of the Telemetry Feed on to another app, such as SimHub, so both can use it at the same time.
_Avoid_: relay, redirect, mirroring

### What the app shows

**Live Dashboard**:
The screen you glance at while driving, shown on a phone or tablet beside your wheel.
_Avoid_: HUD, overlay, dash, display

**Delta**:
The time difference between your current lap and the Reference Lap, at the same point on the track. Negative (green) means you are faster.
_Avoid_: gap (that is the time to another car), split

**Gap**:
The time between you and the car directly ahead of or behind you on track, shown in races.
_Avoid_: delta (that is time against your own lap), interval (on F1 TV that means only the gap to the car ahead)

**Input Trace**:
A rolling graph of your throttle and brake over the last few seconds, so you can see how you release the brake into corners.
_Avoid_: pedal graph, inputs overlay

**Track Map**:
The drawn outline of the circuit, made from your own first full lap there. Car positions and Driving Lines are shown on it.
_Avoid_: circuit map, minimap

**Lap Analysis**:
The screen you use after a session to compare Recorded Laps with each other.
_Avoid_: post-session view, review

### What the app records

**Recorded Lap**:
One lap of the Player Car, saved from the Telemetry Feed so it can be compared later. Every lap is recorded, including invalid, incomplete, out- and in-laps.
_Avoid_: saved lap, lap log, stint (a stint is several laps on one set of tyres)

**Invalid Lap**:
A Recorded Lap the game flagged as invalid, for example for track limits. It can never be a Best Lap.
_Avoid_: deleted lap, bad lap

**Incomplete Lap**:
A Recorded Lap that never reached the finish line (you restarted, quit or retired), or one the app did not see from the start because it was opened mid-lap.
_Avoid_: partial lap, aborted lap

**Out-Lap**:
The lap that starts in the pit lane and ends at your first crossing of the finish line.
_Avoid_: warm-up lap, formation lap (that is a different thing in a race)

**In-Lap**:
The lap that ends in the pit lane.
_Avoid_: cool-down lap

**Car Generation**:
Whether you are driving the 2025 cars or the 2026 cars added by the 2026 Season Pack. Other kinds of car (F2, F1 Classic, generic cars) each get their own group. Laps from different generations are never compared.
_Avoid_: car type, season, era

**Session Type**:
The kind of session a lap was driven in: Time Trial, Practice, Qualifying (including sprint shootout and one-shot qualifying) or Race (including sprint races).
_Avoid_: mode, game mode (Career and Grand Prix are game modes that contain several Session Types)

**Conditions**:
Whether a lap counts as dry or wet, decided by the tyres you were on: slicks mean dry, intermediates or full wets mean wet.
_Avoid_: weather (that is the game's report, which changes during a session)

**Best Lap**:
Your fastest valid, complete Recorded Lap that is not an Out-Lap or In-Lap. A separate Best Lap is kept for each combination of circuit, Car Generation, Session Type and Conditions.
_Avoid_: PB, fastest lap (in a race, that means the fastest lap by anyone)

**Reference Lap**:
The lap your current lap is compared against for Delta. In Time Trial it is your all-time Best Lap. In every other Session Type it is your fastest valid lap so far in that session. Until one exists, there is no Delta.
_Avoid_: target lap, ghost (that is the game's own feature)

**Driving Line**:
The path the Player Car actually took around the track during one Recorded Lap.
_Avoid_: racing line (that is the ideal line, not the one you drove), trajectory, path

### Driving technique

**Braking Zone**:
The stretch of track from where you first press the brake before a corner to where you fully release it.
_Avoid_: braking point (that is only where the zone starts), corner entry

**Trail Braking**:
Releasing the brake gradually while turning into a corner, instead of releasing it fully before turning.
_Avoid_: brake trailing, late braking (that means braking later, not releasing slowly)
