/** Shared by the Matribox MCP tests: a synthetic catalog and a server wired to the simulated unit. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { matriboxLink, parseMbCatalog } from '@pocket-master/core';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import { MatriboxSession } from '../src/matribox-session.ts';
import { Session } from '../src/session.ts';
import { createServer } from '../src/tools.ts';

// Synthetic catalog (invented models) with the fxids of the owner's "Drive AD"; CAB 0x0a000006 is left
// out on purpose. The real alg_data.json is Sonicake's and never used in tests.
const w = (name: string, ID: string, min = '0', max = '100') => ({ name, ID, defaultValue: min, min, max, step: '1' });
const model = (fxid: number, name: string, origin: string, widget: unknown[], descriptionEN = '') => ({ fxid, index: 0, name, origin, descriptionEN, widget });
export const CATALOG = parseMbCatalog({
  Modules: [
    { name: 'DYN', index: 0, alg: [model(0x1b, 'Fake Gate', 'Imaginary Gate\nAlias: Gate X', [w('Threshold', '0', '-80', '0')])] },
    {
      name: 'DRV',
      index: 3,
      alg: [
        model(0x0300002a, 'Fake Drive', 'Imaginary Overdrive 808', [w('Gain', '0'), w('Tone', '1'), w('Volume', '2')], 'A mid-boost overdrive. Second sentence.'),
        model(0x03000010, 'Fake Fuzz', 'Imaginary Fuzz Face', [w('Fuzz', '0'), w('Level', '1')]),
      ],
    },
    { name: 'AMP', index: 4, alg: [model(0x0700001a, 'Fake Plexi', 'Imaginary Plexi 50W', [w('Gain', '0'), w('Master', '5')])] },
    { name: 'CAB', index: 5, alg: [model(0x0a000001, 'Fake 4x12', '55', [w('Volume', '1')])] },
    { name: 'IR', index: 6, alg: [model(0x0a100000, 'User IR 1', '', [w('Volume', '1')])] },
    { name: 'DLY', index: 9, alg: [model(0x0b000001, 'Fake Echo', 'Imaginary Tape Echo', [w('Mix', '0'), w('Time', '1', '20', '2000')])] },
    { name: 'RVB', index: 10, alg: [model(0x0c00000b, 'Fake Hall', '', [w('Mix', '0'), w('Decay', '1')])] },
    { name: 'CLONE', index: 11, alg: [model(0x0f000000, 'Clone 1', '', [w('Gain', '0')])] },
    { name: 'VOL', index: 15, alg: [model(0x06000003, 'Volume', 'Volume', [w('Volume', '0')])] },
  ],
});

export const fakeLink = (fake = new FakeMatribox(), timeoutMs = 1000) => {
  const ports = { send: (b: Uint8Array) => fake.send(b), listen: (r: ((b: Uint8Array) => void) | null) => fake.listen(r ?? (() => undefined)) };
  return matriboxLink(ports, timeoutMs);
};

export async function connected(options: { catalog?: () => Promise<typeof CATALOG>; ports?: readonly string[] } = {}) {
  const fake = new FakeMatribox();
  const link = fakeLink(fake);
  const dir = mkdtempSync(join(tmpdir(), 'mb-tools-'));
  const backups = join(dir, 'b');
  const presets = join(dir, 'p', 'matribox');
  const irs = join(dir, 'i');
  const matribox = new MatriboxSession(() => ({ ...link, close: () => undefined }), options.catalog ?? (async () => CATALOG), { backups, presets, irs });
  const pocketMaster = new Session(() => Promise.reject(new Error('no Pocket Master in this test')) as never, { backups, presets: join(dir, 'p'), irs, nams: join(dir, 'n') });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([createServer(pocketMaster, { matribox, midiPorts: async () => options.ports ?? ['Matribox II PRO'] }).connect(a), client.connect(b)]);
  return { client, fake, backups, presets, irs };
}

export const text = (r: unknown) => (r as { content: { text: string }[] }).content.map((c) => c.text).join('\n');
export const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => text(await client.callTool({ name, arguments: args }));
