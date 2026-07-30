---
title: Architecture
description: Request flow, verb mapping, and the stateless per-request server model behind feathers-mcp.
---

## Two protocol eras, one endpoint

The service holds a single MCP HTTP handler (`createMcpHandler` from
`@modelcontextprotocol/server` v2, adapted to Node by `toNodeHandler`). It classifies every
request by its own content:

- **Modern** (`2026-07-28`) — the request carries the per-request `_meta` envelope, plus the
  `MCP-Protocol-Version` and routable `Mcp-Method` headers. Served natively, including
  `server/discover`.
- **Legacy** (`2025-11-25` and earlier) — anything else. Served statelessly: a fresh instance
  answers each request, and the `initialize` handshake still works exactly as a 2025-era client
  expects.

Clients on the retired `@modelcontextprotocol/sdk` v1 — which is what most host apps still ship —
keep working unchanged.

## Verb mapping

MCP POSTs every JSON-RPC message in both eras. GET (the 2025-era standalone SSE stream) and
DELETE (2025-era session termination) are session operations, and stateless serving answers them
**405**. In Feathers an id-less GET maps to `find`, **not** `get`, so a GET lands on `find`; all
four verbs are registered and forwarded anyway, so the refusal is the MCP SDK's own rather than a
Feathers 404.

## Request flow

1. **Raw socket handoff.** Transport middleware stashes the raw Node `req`/`res` onto `params`
   (`koaRequest`/`koaResponse` under Koa, `expressRequest`/`expressResponse` under Express);
   `getRawHttp()` reads them back inside the service. The two halves must agree on the key
   names — under Express they silently didn't for a while, which is why Express never worked
   until that was fixed.
2. **Telling the framework to keep out of the socket.** Under Koa, `ctx.respond = false` is set
   **only after `await next()` and only if `res.headersSent`** — setting it up front also gags
   Koa's error handler, so an auth failure (which happens before the handler ever sees the
   request) would hang the client instead of returning 401. Express has no equivalent flag, so
   an `after` middleware stops the chain once `headersSent` is true, so the REST formatter can't
   set headers on a response that's already been sent.
3. **Hooks.** `allowMcpApiKey()` pulls a `Bearer` key off the configured header and rewrites
   `params.authentication` to the configured strategy; `authenticate()` then runs. Every MCP call
   is therefore an authenticated Feathers call, and tool handlers get a real `params.user`.

## Stateless per-request serving

There is no session map, no idle sweep, no session cap and no session-ownership check. The
handler's factory runs **once per request** and builds an `McpServer` whose tool callbacks close
over that request's Feathers params — so a handler cannot be handed another caller's context,
by construction rather than by bookkeeping.

Params reach the factory through the handler's pass-through `authInfo`: the service sets
`req.auth`, `toNodeHandler` forwards it verbatim, and the factory reads it back off
`ctx.authInfo`. Nothing in the MCP SDK reads, validates or transmits it.

Tool input schemas are converted **once at boot**, not per request, so a malformed TypeBox schema
fails at startup with the offending tool's name on it rather than as a 500 on someone's first
`tools/list`.

See [Statelessness](/docs/sessions/) for what this replaced and why.

## Tools

- `BaseTool` is the extension point: `name`, `description`, TypeBox `inputSchema`/`outputSchema`,
  `expose` (`{ mcp, openai }`), and `handler(input, params, emit)`.
- `McpToolHandler` is the registry, on the app under `app.get('mcpToolHandler')`. `expose` is
  static and global — every authenticated key sees the same tool list, so per-user authorization
  belongs in Feathers hooks on the services a handler calls, not in the tool registry.
- **Schemas are TypeBox at the author boundary, Zod at the SDK boundary.** The MCP SDK's schema
  type doesn't accept raw JSON Schema, so a converter hand-translates TypeBox to Zod.

See [Writing tools](/docs/tools/) for the tool-authoring API in full.
