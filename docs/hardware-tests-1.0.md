# Hardware tests before 1.0

What only the real pedal can check (milestone 1.0.0). About an hour; a guitar is needed only
for step 4. Before anything: close SonicMaster and every other editor tab (another client on the
port steals replies). Write only to spare slots: since 0.14.0 a save does not back the slot up
first.

## 1. Read-only probe, 2 min

Pedal on USB, nothing else connected to it:

    node apps/mcp/scripts/probe-pedal.ts

It only reads. Besides the firmware version, it reads the loaded slot without loading it (a
command from klotznick's guide) and says whether that matches the edit buffer; if it does,
backups can stop loading each slot. Then run it once more with `--scan` (about a minute; it
also tries the battery and charge reads, which may only answer over Bluetooth). Send both log
files it prints at the end.

## 2. Global options (#90), 10 min

Web editor (or desktop app) over USB, gear button:
- The values shown match the pedal's own menus: master volume, the four levels, backlight and
  power-off confirm.
- Change one level and the backlight; check them on the pedal; put them back.
- Do not touch factory reset.

## 3. Bluetooth (#89), 15 min

Pedal's Bluetooth on, USB unplugged. In Chrome, *Connect via Bluetooth*:
- Computer: turn a knob and hear it; save to a spare slot and check its name
  on the pedal.
- Switch the pedal off while connected: the editor says it disconnected.
- Android phone, Chrome, same site: connect, read the preset, turn a knob.

## 4. TONE3000 from the web editor (#91), 10 min

TONE3000 panel: sign in, search a capture, install it into an **empty** profile slot (slot 1
holds Randall SA). Pick it on AMP and play.

## 5. Phone layout (#92), 5 min

On the Android phone: the preset list folds behind its button, the arrows under the tiles move a
block in the chain, the model menu opens at the bottom of the screen.

## 6. With Claude, if there is time, 10 min

Copying a preset to another slot and turning the tuner on and off are writes the guide
documents but this project has not tried. They are done together in the session, on a spare
slot.

Write down for each step: OK, or what happened. Each result closes its issue or turns into a fix.
