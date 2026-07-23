---
title: Architecture
description: Request flow, verb mapping, and the per-session server model behind feathers-mcp.
---

## Verb mapping

MCP POSTs every JSON-RPC message, GETs the bare endpoint for the standalone SSE stream, and
DELETEs it to end the session. In Feathers an id-less GET maps to `find`, **not** `get` — so
the SSE stream lands on `find`. Registering only `create`/`get` leaves the SSE stream returning
405.

## Request flow

1. **Raw socket handoff.** Transport middleware stashes the raw Node `req`/`res` onto `params`
   (`koaRequest`/`koaResponse` under Koa, `expressRequest`/`expressResponse` under Express);
   `getRawHttp()` reads them back inside the service. The two halves must agree on the key
   names — under Express they silently didn't for a while, which is why Express never worked
   until that was fixed.
2. **Telling the framework to keep out of the socket.** Under Koa, `ctx.respond = false` is set
   **only after `await next()` and only if `res.headersSent`** — setting it up front also gags
   Koa's error handler, so an auth failure (which happens before the transport ever sees the
   request) would hang the client instead of returning 401. Express has no equivalent flag, so
   an `after` middleware stops the chain once `headersSent` is true, so the REST formatter can't
   set headers on a response that's already been sent.
3. **Hooks.** `allowMcpApiKey()` pulls a `Bearer` key off the configured header and rewrites
   `params.authentication` to the `mcpApiKey` strategy; `authenticate('mcpApiKey')` then runs.
   Every MCP call is therefore an authenticated Feathers call, and tool handlers get a real
   `params.user`.

## Sessions

**One `McpServer` per session, never shared.** The SDK's `Protocol.connect()` keeps a single
`_transport` slot and overwrites it on every connect — its own docstring says it assumes
exclusive ownership. A server shared across sessions therefore routes every response, and every
`extra.sessionId`, to whichever session connected *last*. Tool callbacks close over their own
session; there is deliberately no session-id lookup inside a handler. Sessions are also bound to
the principal that opened them (resolved through `authentication.entityId`, not a hard-coded
`id`), so a valid-but-different user cannot drive someone else's session.

Within one session, a handler gets the params of *its own* request via a map keyed on the
request id, not a single mutable `session.params` — several calls can be in flight at once. That
map is cleaned up whether or not the tool callback ever ran: the SDK skips the callback entirely
for an unknown tool name or a schema-validation failure, and every skipped call would otherwise
pin the caller's params — including the raw API key — for the life of the session.

Sessions are reaped by idle TTL and capped by count, both swept lazily on request rather than on
a timer — a library has no business holding an interval open in a host's event loop. The MCP
client does **not** send DELETE on a plain `close()`, only on `terminateSession()`, so the idle
TTL is the only thing that frees an ordinarily-disconnected session. Sessions live in process
memory, so this does not scale horizontally without sticky sessions.

Errors are written straight to the raw response, because under Koa's `respond = false` anything
the service *returns* is silently dropped.

## Tools

- `BaseTool` is the extension point: `name`, `description`, TypeBox `inputSchema`/`outputSchema`,
  `expose` (`{ mcp, openai }`), and `handler(input, params, emit)`.
- `McpToolHandler` is the registry, on the app under `app.get('mcpToolHandler')`. `expose` is
  static and global — every authenticated key sees the same tool list, so per-user authorization
  belongs in Feathers hooks on the services a handler calls, not in the tool registry.
- **Schemas are TypeBox at the author boundary, Zod at the SDK boundary.** The MCP SDK's schema
  type doesn't accept raw JSON Schema, so a converter hand-translates TypeBox to Zod at
  registration — a bad schema fails at boot with the tool's name on it, not as a 500 on the
  first `initialize`.

See [Writing tools](/docs/tools/) for the tool-authoring API in full, and
[Sessions](/docs/sessions/) for the session lifecycle in more depth.
