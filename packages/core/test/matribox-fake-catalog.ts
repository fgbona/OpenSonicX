/**
 * An invented alg_data.json (same shape as the official editor's file) with the fxids of the owner's
 * "Drive AD", for tests of the editors. CAB 0x0a000006 is left out on purpose: an unknown model. The
 * real alg_data.json is Sonicake's and never used in tests.
 */
const w = (name: string, ID: string, min = '0', max = '100') => ({ name, ID, defaultValue: min, min, max, step: '1' });
const model = (fxid: number, name: string, origin: string, widget: unknown[], descriptionEN = '') => ({ fxid, index: 0, name, origin, descriptionEN, widget });

export const FAKE_ALG_DATA = {
  Modules: [
    { name: 'DYN', index: 0, alg: [model(0x1b, 'Fake Gate', 'Imaginary Gate\nAlias: Gate X', [w('Threshold', '0', '-80', '0')])] },
    { name: 'DRV', index: 3, alg: [model(0x0300002a, 'Fake Drive', 'Imaginary Overdrive 808', [w('Gain', '0'), w('Tone', '1'), w('Volume', '2')], 'A mid-boost overdrive.'), model(0x03000010, 'Fake Fuzz', 'Imaginary Fuzz Face', [w('Fuzz', '0'), w('Level', '1')])] },
    { name: 'AMP', index: 4, alg: [model(0x0700001a, 'Fake Plexi', 'Imaginary Plexi 50W', [w('Gain', '0'), w('Master', '5')])] },
    { name: 'CAB', index: 5, alg: [model(0x0a000001, 'Fake 4x12', '55', [w('Volume', '1')])] },
    { name: 'IR', index: 6, alg: [model(0x0a100000, 'User IR 1', '', [w('Volume', '1')])] },
    { name: 'DLY', index: 9, alg: [model(0x0b000001, 'Fake Echo', 'Imaginary Tape Echo', [w('Mix', '0'), w('Time', '1', '20', '2000')])] },
    { name: 'RVB', index: 10, alg: [model(0x0c00000b, 'Fake Hall', '', [w('Mix', '0'), w('Decay', '1')])] },
    { name: 'CLONE', index: 11, alg: [model(0x0f000000, 'Clone 1', '', [w('Gain', '0')])] },
    { name: 'VOL', index: 15, alg: [model(0x06000003, 'Volume', 'Volume', [w('Volume', '0')])] },
  ],
};
