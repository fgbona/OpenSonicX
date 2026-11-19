#!/usr/bin/env node
import { appendFile, mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { connectPocketMaster } from './midi.ts';
import { Session } from './session.ts';
import { createServer } from './tools.ts';

// stdout carries the MCP protocol: everything else goes to stderr.
const home = process.env.POCKET_MASTER_HOME ?? join(homedir(), '.pocket-master-editor');
const session = new Session(() => connectPocketMaster(), { backups: join(home, 'backups'), presets: join(home, 'presets'), irs: join(home, 'irs') });
// One line per tool call: how long it spent on the pedal, to tell pedal time from the assistant's thinking.
const timings = join(home, 'timings.log');
await mkdir(home, { recursive: true });
const onTiming = ({ tool, ms, ok }: { tool: string; ms: number; ok: boolean }) =>
  void appendFile(timings, `${new Date().toISOString()} ${tool} ${ms} ms${ok ? '' : ' (error)'}\n`).catch((e) => console.error('could not write timings', e));
await createServer(session, { onTiming }).connect(new StdioServerTransport());
console.error(`pocket-master MCP server ready (files in ${home})`);
