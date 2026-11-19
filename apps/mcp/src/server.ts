#!/usr/bin/env node
import { homedir } from 'node:os';
import { join } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { connectPocketMaster } from './midi.ts';
import { Session } from './session.ts';
import { createServer } from './tools.ts';

// stdout carries the MCP protocol: everything else goes to stderr.
const home = process.env.POCKET_MASTER_HOME ?? join(homedir(), '.pocket-master-editor');
const session = new Session(() => connectPocketMaster(), { backups: join(home, 'backups'), presets: join(home, 'presets') });
await createServer(session).connect(new StdioServerTransport());
console.error(`pocket-master MCP server ready (files in ${home})`);
