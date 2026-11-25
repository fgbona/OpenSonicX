# Security

Please report security problems privately, through **Report a vulnerability** in this repository's
Security tab, not in a public issue.

Worth reporting, for example:

- anything that could read the AI keys the tone assistant keeps in the browser, or send them anywhere
  but Groq and Google;
- a way for a web page, a preset file, a backup file or a TONE3000 download to make the editor write
  to the pedal without the person's click;
- anything in the desktop app's update path that could install something other than this
  repository's GitHub release.

## What the editor keeps, and where

There is no server (except the desktop app's opt-in AI connection, below, which listens on this computer only). The editor and the desktop app talk only to the pedal, to TONE3000 (when you
use it), and to the AI provider whose key you added. In the browser's storage for the site (or the
desktop app), and nowhere else, it keeps:

| What | Storage key |
|---|---|
| Backups made before each save | `pocket-master-editor.backups.v1` |
| Groq and Gemini keys, if you added them | `pocket-master-editor.groqKey.v1`, `pocket-master-editor.geminiKey.v1` |
| Paid AI providers you added: key and chosen model | `pocket-master-editor.aiProviders.v1` |
| Whether keys are remembered after the browser closes (only when turned off) | `pocket-master-editor.aiRemember.v1` |
| Today's estimated spend on paid AI providers | `pocket-master-editor.aiSpend.v1` |
| The assistant's answer order and the rotation switch | `pocket-master-editor.aiOrder.v1`, `pocket-master-editor.aiRotate.v1` |
| How many assistant requests were sent today | `pocket-master-editor.geminiUsage.v1` |
| Your preset library | `pocket-master-editor.presetLibrary.v1` |
| Notes on slots | `pocket-master-editor.slotNotes.v1` |
| Your TONE3000 sign-in, if you signed in | `pocket-master-editor.tone3000` |
| Theme, language, and whether the MIDI log is shown | `pocket-master-editor.theme`, `.lang`, `.showLog` |

Clearing the site's data in the browser removes all of it. The tone assistant sends your messages
and the loaded preset to the provider that answers; on free plans the provider may use them to
improve its products (the panel says so before a key is saved).

## The desktop app's AI connection

The desktop app can serve the editor's tone tools as MCP over HTTP to an AI client on the same
computer (README, *AI connection*). It is off until the person turns it on in the app, and
turning it off closes the server.

What it defends against, and how:

| Threat | Defence |
|---|---|
| Another computer on the network | The server binds 127.0.0.1 only (tested), never `0.0.0.0` or `::`. |
| Another program or user on this computer | Every request needs `Authorization: Bearer <token>`: 256 random bits, made on first enable, kept in `ai-connection.json` in the app's user data (mode 0600), compared in constant time. Without it: 401. *Regenerate* invalidates the old token at once. |
| A web page in a browser (CSRF, DNS rebinding) | A Host other than `127.0.0.1:<port>` or `localhost:<port>` gets 403; any request with an `Origin` header (browsers always send one; MCP clients do not) gets 403, unless the origin is in an allowlist, which is empty. No CORS headers are ever sent, so a page cannot read an answer either. |
| A flood of requests | Bodies over 1 MiB get 413; more than 300 requests a minute get 429. |
| An AI writing to the unit without the person | Saves need `confirm` repeating the slot label and then the person's Allow in a native app dialog naming the slot (the window's page cannot answer it); the editor's Save dialog then opens as usual. Live edits show on screen and Undo takes them back. |
| The token leaking through logs or the page | The token is never logged. The editor page gets only a masked form; copying the token or the setup command is done by the main process. |

Inside the app, the page talks to the main process through one preload bridge that exposes only
the AI connection (switch, state, copy, and answering tool calls); the main process accepts those
messages only from the editor's own `app://editor` page.

Out of scope: a program already running as the same user can read the app's user data, token
included, as it could read any MCP client's configuration. Do not turn the connection on in an
account you share with software you do not trust.

Worth reporting: any way to reach the AI connection's tools without the token, from a web page,
or from another machine; any way to store on the unit through it without the person's Allow.
