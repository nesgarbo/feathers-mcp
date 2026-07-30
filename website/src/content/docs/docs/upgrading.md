---
title: Upgrading
description: 3.0.0 moves to MCP SDK v2 and serves protocol revision 2026-07-28.
---

## Upgrading to 3.0.0

3.0.0 moves off the retired monolithic `@modelcontextprotocol/sdk` v1 onto the v2 packages, and
serves MCP protocol revision **`2026-07-28`** natively alongside the 2025-era protocol.

### Change your peer dependencies

`@modelcontextprotocol/sdk` is gone. Install the two packages that replace it:

```bash
npm remove @modelcontextprotocol/sdk
npm install @modelcontextprotocol/server @modelcontextprotocol/node
```

Also required: **Node.js 20+** and **zod 4.2+** (v2's own peer floor).

### Serving is now stateless

There are no sessions. Every request is authenticated and served on its own, by a fresh
`McpServer` whose tool callbacks close over that request's Feathers params.

- `sessionTtlMs` and `maxSessions` are **no-ops** — accepted and ignored so your `feathersMcp()`
  call doesn't break, but delete them.
- 2025-era `GET` (standalone SSE stream) and `DELETE` (session termination) now answer **405**.
  Nothing in this library used them.
- Running more than one instance no longer needs sticky sessions.

Full detail in [Statelessness](/docs/sessions/).

### What did not change

Tool authoring, `BaseTool`, TypeBox schemas, `emit`, return values, authentication strategies and
every `feathersMcp()` option other than the two above are unchanged. Clients on the v1 SDK — which
is what most host apps still ship — keep working without modification.

## Upgrading from 1.x to 2.x

2.0.0 was a correctness and security release — several of the fixes change behaviour, hence the
major. Published versions jumped from 1.0.7 (the last 1.x release on npm) straight to 2.0.0.

The headline fixes:

- **Sessions no longer share a single `McpServer`.** Under 1.x, two concurrent clients could
  have one caller's tool call execute as another caller's authenticated user. See
  [Sessions](/docs/sessions/).
- **`BaseTool.resourceFromUploadId` was an IDOR** — it called the uploads service with no
  `params`, so every params-based authorization hook was skipped. It now requires `params` and
  is a breaking signature change: `resourceFromUploadId(uploadId, uri, params, appendOriginalName?)`.
- **The standalone SSE stream now actually works** — an id-less GET maps to Feathers' `find`,
  not `get`; only registering `create`/`get` (1.x's setup) left it 405ing.
- **Express is now covered by the integration suite** alongside Koa; a params key mismatch
  between the transport middleware and the service silently broke it before.
- **Content blocks now match the MCP spec exactly** — `image` is flat
  (`{type, data, mimeType}`) with raw base64, `resource` carries binary under `blob`, not
  `data`.
- Literal/enum TypeBox schemas are now actually validated and reach the model correctly;
  previously they silently degraded to an unconstrained `z.string()`.

Full details, including every fix and every breaking change, are in the
[CHANGELOG](https://github.com/nesgarbo/feathers-mcp/blob/main/CHANGELOG.md).
