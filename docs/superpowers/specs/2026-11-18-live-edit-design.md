# Live editing (phase 2)

## Intent

The owner validated the read-only release on the pedal (P08, firmware V1.3.3)
and approved phase 2: change the sound live from the browser. Edits change
only the pedal's edit buffer. Saving to a slot stays out of scope (phase 3).

## Scope, in this order

1. Parameter values and block on/off.
2. Model per block (for example Scream to another drive).
3. Chain order, with DRV-AMP-IR-EQ moving as one group.

Plus a restore point: the first read after connecting (or after Read) is kept,
and Revert sends what is needed to bring the edit buffer back to it.

## Non-goals

- Saving to a slot (`0x4A`), selecting presets (`0x43`), global settings
  (`0x11 0x11`) and preset volume. The edit guard refuses them.
- Captured-profile (clone) selection for AMP; normal amp models only.
- Mirroring knob turns made on the pedal; Read re-reads.

## Constraints from the protocol

- Set commands get no acknowledgement. The UI updates optimistically for
  parameters and on/off, and re-reads the edit buffer after a model or chain
  change, because the pedal applies model defaults.
- Selecting an AMP model while the preset is in clone mode first switches amp
  mode back to normal (`11 49`, module 9, value 0).
- Chain order must keep DRV, AMP, IR, EQ adjacent and in that order.
- All builders are checked byte for byte against the ~7400 captured commands
  in pocket-master-mcp's fixture (MIT).

## Safety

- Editing is off until the user turns on Live edit; the page says edits go
  to the pedal at once.
- The web link has two send paths: read (GET only) and edit (only `11 44`,
  `11 47`, `11 48`, `11 49`). Anything else throws before reaching the port.
- Slider drags are coalesced: at most one message per parameter every 30 ms,
  the last value always sent.

## Approaches considered

1. **Pure command builders and a pure diff in core, UI in web** (chosen).
   Revert is `diffPresets(current, restorePoint)` turned into commands, which
   the MCP can reuse.
2. Revert by re-sending the whole snapshot. Simpler, but sends ~80 messages
   for one changed knob and can change models needlessly.
3. Keep edit state only in React. Untestable outside the browser.

The owner approved the three-step scope and the restore point; the approach
is my call.
