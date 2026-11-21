import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeGlobals } from '../src/globals.ts';

const G = { masterVolume: 80, inputLevel: -3, fxRecLevel: 2, monitorLevel: 0, btRecLevel: 0, backlight: 6, mode: 1, bootProtection: 1, reamp: null, eco: null, expFsType: null };

test('the settings summary names the firmware, and says when it is not the tested one', () => {
  assert.match(describeGlobals({ ...G, firmware: 'V1.3.3' }), /^Firmware V1\.3\.3\nMaster volume 80/);
  assert.match(describeGlobals({ ...G, firmware: 'V1.4.0' }), /^Firmware V1\.4\.0 \(this server was tested on V1\.3\.3/);
  assert.match(describeGlobals({ ...G, firmware: null }), /^Master volume 80/);
});
