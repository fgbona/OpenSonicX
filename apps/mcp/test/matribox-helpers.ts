/** Shared by the Matribox MCP tests: a synthetic catalog and a server wired to the simulated unit. */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { matriboxLink, type MbCatalog } from '@pocket-master/core';
import { fakeCatalog, fakeModel as model, fakeParam as w } from '../../../packages/core/test/matribox-fake-catalog.ts';
import { FakeMatribox } from '../../../packages/core/test/fake-matribox.ts';
import type { CloneConverter } from '../src/matribox-clone.ts';
import { MatriboxSession } from '../src/matribox-session.ts';
import { Session } from '../src/session.ts';
import { createServer } from '../src/tools.ts';

// Synthetic catalog (invented models) with the fxids of the owner's "Drive AD"; CAB 0x0a000006 is left
// out on purpose.
export const CATALOG = fakeCatalog([
  ['DYN', 0, [model(0x1b, 'Fake Gate', 'Imaginary Gate', [w('Threshold', 0, -80, 0)])]],
  [
    'DRV',
    3,
    [
      model(0x0300002a, 'Fake Drive', 'Imaginary Overdrive 808', [w('Gain', 0), w('Tone', 1), w('Volume', 2)], 'A mid-boost overdrive. Second sentence.'),
      model(0x03000010, 'Fake Fuzz', 'Imaginary Fuzz Face', [w('Fuzz', 0), w('Level', 1)]),
    ],
  ],
  ['AMP', 4, [model(0x0700001a, 'Fake Plexi', 'Imaginary Plexi 50W', [w('Gain', 0), w('Master', 5)])]],
  ['CAB', 5, [model(0x0a000001, 'Fake 4x12', '', [w('Volume', 1)])]],
  ['IR', 6, [model(0x0a100000, 'User IR 1', '', [w('Volume', 1)])]],
  ['DLY', 9, [model(0x0b000001, 'Fake Echo', 'Imaginary Tape Echo', [w('Mix', 0), w('Time', 1, 20, 2000)])]],
  ['RVB', 10, [model(0x0c00000b, 'Fake Hall', '', [w('Mix', 0), w('Decay', 1)])]],
  ['CLONE', 11, [model(0x0f000000, 'Clone 1', '', [w('Gain', 0)])]],
  ['VOL', 15, [model(0x06000003, 'Volume', 'Volume', [w('Volume', 0)])]],
]);

export const fakeLink = (fake = new FakeMatribox(), timeoutMs = 1000) => {
  const ports = { send: (b: Uint8Array) => fake.send(b), listen: (r: ((b: Uint8Array) => void) | null) => fake.listen(r ?? (() => undefined)) };
  return matriboxLink(ports, timeoutMs);
};

export async function connected(options: { catalog?: MbCatalog; ports?: readonly string[]; convertClone?: CloneConverter } = {}) {
  const fake = new FakeMatribox();
  const link = fakeLink(fake);
  const dir = mkdtempSync(join(tmpdir(), 'mb-tools-'));
  const backups = join(dir, 'b');
  const presets = join(dir, 'p', 'matribox');
  const irs = join(dir, 'i');
  const nams = join(dir, 'n');
  const matribox = new MatriboxSession(() => ({ ...link, close: () => undefined }), { backups, presets, irs }, options.catalog ?? CATALOG, options.convertClone);
  const pocketMaster = new Session(() => Promise.reject(new Error('no Pocket Master in this test')) as never, { backups, presets: join(dir, 'p'), irs, nams });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0' });
  await Promise.all([createServer(pocketMaster, { matribox, midiPorts: async () => options.ports ?? ['Matribox II PRO'] }).connect(a), client.connect(b)]);
  return { client, fake, backups, presets, irs, nams };
}

export const text = (r: unknown) => (r as { content: { text: string }[] }).content.map((c) => c.text).join('\n');
export const call = async (client: Client, name: string, args: Record<string, unknown> = {}) => text(await client.callTool({ name, arguments: args }));
