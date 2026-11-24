import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bleMidiPort, BleSysexAssembler, bleWire, type GattCharacteristic } from '../lib/ble.ts';

test('bleWire puts the BLE-MIDI header and timestamp before the SysEx, as SonicMaster sends it', () => {
  assert.deepEqual([...bleWire(Uint8Array.of(0xf0, 0x01, 0x02, 0xf7))], [0x80, 0x80, 0xf0, 0x01, 0x02, 0xf7]);
});

test('the assembler drops BLE header and timestamp bytes and joins a SysEx split across notifications', () => {
  const a = new BleSysexAssembler();
  assert.deepEqual(a.feed(Uint8Array.of(0x80, 0x80, 0xf0, 0x01, 0x02)), []);
  assert.deepEqual(
    a.feed(Uint8Array.of(0x81, 0x03, 0x84, 0xf7)).map((m) => [...m]),
    [[0xf0, 0x01, 0x02, 0x03, 0xf7]],
  );
  // two complete messages in one notification, and noise before the first F0
  assert.deepEqual(
    a.feed(Uint8Array.of(0x80, 0x05, 0x80, 0xf0, 0x0a, 0xf7, 0x80, 0xf0, 0x0b, 0xf7)).map((m) => [...m]),
    [
      [0xf0, 0x0a, 0xf7],
      [0xf0, 0x0b, 0xf7],
    ],
  );
  // a new F0 before an F7 starts over instead of gluing two messages
  assert.deepEqual(
    a.feed(Uint8Array.of(0x80, 0x80, 0xf0, 0x01, 0x80, 0xf0, 0x02, 0xf7)).map((m) => [...m]),
    [[0xf0, 0x02, 0xf7]],
  );
});

test('bleMidiPort writes one frame at a time and reports a failed write', async () => {
  const writes: number[][] = [];
  let release: () => void = () => undefined;
  const errors: unknown[] = [];
  let listener: ((e: { target: { value: DataView } }) => void) | null = null;
  let calls = 0;
  const characteristic = {
    writeValueWithoutResponse: (v: Uint8Array) => {
      writes.push([...v]);
      calls++;
      if (calls === 1)
        return new Promise<void>((r) => {
          release = r;
        });
      if (calls === 3) return Promise.reject(new Error('GATT gone'));
      return Promise.resolve();
    },
    addEventListener: (_: string, l: typeof listener) => {
      listener = l;
    },
    removeEventListener: () => {
      listener = null;
    },
  };
  const port = bleMidiPort(characteristic as unknown as GattCharacteristic, (e) => errors.push(e));
  port.send(Uint8Array.of(0xf0, 1, 0xf7));
  port.send(Uint8Array.of(0xf0, 2, 0xf7));
  port.send(Uint8Array.of(0xf0, 3, 0xf7));
  await new Promise((r) => setImmediate(r));
  assert.equal(writes.length, 1); // the second waits for the first
  release();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(writes.length, 3);
  assert.match(String(errors[0]), /GATT gone/);

  const got: number[][] = [];
  port.listen((b) => void got.push([...b]));
  listener!({ target: { value: new DataView(Uint8Array.of(0x80, 0x80, 0xf0, 0x07, 0xf7).buffer) } });
  port.listen(null);
  assert.equal(listener, null);
  assert.deepEqual(got, [[0xf0, 0x07, 0xf7]]);
});
