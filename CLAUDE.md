# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`feathers-mcp` is a **library** (published to npm), not an application. It plugs a Model Context Protocol server into an existing FeathersJS v5 app as a regular Feathers service. Consumers call `app.configure(feathersMcp({ tools: [...] }))`.

There is no runnable app here. The end-to-end surface is exercised by [test/test-app.ts](test/test-app.ts), which builds throwaway Feathers Koa and Express apps and drives them with real MCP clients over HTTP — that is the place to reproduce anything session- or transport-related.

## Commands

```bash
npm run build       # tsup -> dist/ (ESM + CJS + .d.ts). Also runs on `npm prepare`.
npm test            # vitest run
npm run dev         # vitest watch
npm run typecheck   # tsc --noEmit
npm run lint        # eslint . (flat config)
```

Single test: `npx vitest run test/units.test.ts` or `npx vitest run -t "<test name>"`.
Trace MCP sessions: `DEBUG=feathers-mcp npm test`.

**Do not upgrade TypeScript past 5.x.** TS 7 is the native rewrite and its API surface breaks `rollup-plugin-dts` inside tsup — `npm run build` dies with `Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')`. `ncu -u` will happily bump it; don't let it.

## Architecture

The core idea: **MCP's Streamable HTTP transport is bolted onto a Feathers custom service.** The transport writes to the raw Node socket itself, so most of the design is about getting the raw request/response down to it and keeping the framework from writing over it afterwards.

**Verb mapping** ([mcp-server.shared.ts](src/mcp-server/mcp-server.shared.ts)). MCP POSTs every JSON-RPC message, GETs the bare endpoint for the standalone SSE stream, and DELETEs it to end the session. In Feathers an id-less GET maps to `find`, *not* `get` — so the SSE stream lands on `find`. Registering only `create`/`get` (as this once did) leaves the SSE stream returning 405.

**Request flow** ([mcp-server.ts](src/mcp-server/mcp-server.ts))

1. Transport middleware stashes the raw Node `req`/`res` onto `params` (`koaRequest`/`koaResponse`, `expressRequest`/`expressResponse`); [app.ts](src/mcp/app.ts) `getRawHttp()` reads them back. The two halves must agree on the key names — they silently didn't, which is why Express never worked.
2. Then the framework has to be told to keep out of the socket. Koa: set `ctx.respond = false`, but **only after `await next()` and only if `res.headersSent`** — setting it up front also gags Koa's error handler, so an auth failure (which happens before the transport ever sees the request) hangs the client instead of returning 401. Express has no equivalent, so an `after` middleware stops the chain when `headersSent` so the REST formatter can't set headers on a sent response.
3. Hooks: `allowMcpApiKey()` pulls a `Bearer` key off the configured header and rewrites `params.authentication` to the `mcpApiKey` strategy; `authenticate('mcpApiKey')` then runs. Every MCP call is therefore an authenticated Feathers call, and tool handlers get a real `params.user`.

**Sessions** ([mcp-server.class.ts](src/mcp-server/mcp-server.class.ts)). **One `McpServer` per session, never shared.** The SDK's `Protocol.connect()` keeps a single `_transport` slot and overwrites it on every connect — its docstring says it assumes exclusive ownership. A server shared across sessions therefore routes every response, and every `extra.sessionId`, to whichever session connected *last*: with two concurrent agents, A's tool call runs as B's user. Tool callbacks close over their own `McpSession`; there is deliberately no session-id lookup inside a handler. Sessions are also bound to the principal that opened them (`ownerId`, resolved through `authentication.entityId` — not a hard-coded `id`), so a valid-but-different user cannot drive someone else's session id.

Within one session, a handler gets the params of *its own* request via `paramsByRequest` keyed on `extra.requestId`, not a single mutable `session.params` — several calls can be in flight at once. That map is cleaned up in `create()`'s `finally`, not only in the tool callback: the SDK skips the callback entirely for an unknown tool name or a schema-validation failure, and every skipped call would otherwise pin the caller's params — user object *and* the raw API key from the header — for the life of the session. This is safe because `transport.handleRequest` resolves only *after* the handler has run (measured, not assumed).

Sessions are reaped by idle TTL and capped by count. Both are lazy — swept on request, never on a timer, because a library has no business holding an interval open in a host's event loop. The MCP client does *not* send DELETE on a plain `close()` (only on `terminateSession()`), so `transport.onclose` never fires on the ordinary disconnect and the TTL is the only thing that frees those sessions. Sessions live in process memory, so this does not scale horizontally without sticky sessions.

Errors are written straight to the raw response with `writeJsonRpcError`, because under Koa's `respond = false` anything the service *returns* is silently dropped.

**Tools** ([src/mcp/](src/mcp/))

- `BaseTool` is the extension point: `name`, `description`, TypeBox `inputSchema`/`outputSchema`, `expose` (`{ mcp, openai }`), and `handler(input, params, emit)`. `emit` goes out through the SDK's `extra.sendNotification`, which tags notifications with the originating request id so they reach the same stream as the tool call — sending straight down the transport targets the standalone SSE stream, which a POST-only client never opens. The MCP logging method is `notifications/message`; `notifications/log` does not exist.
- `McpToolHandler` is the registry, on the app under `app.get('mcpToolHandler')`. `getForMcp()` feeds the MCP server, `getForOpenAi()` is for host apps that also want OpenAI function-calling schemas. `expose` is static and global — every authenticated key sees the same tool list, so per-user authorization belongs in Feathers hooks on the services a handler calls, not here.
- **Schemas are TypeBox at the author boundary, Zod at the SDK boundary.** The SDK's `AnySchema` is `ZodTypeAny | $ZodType` — it does *not* accept raw JSON Schema, so [typebox-to-zod.ts](src/utils/typebox-to-zod.ts) has to hand-convert. A tool input schema **must be a `Type.Object`**; conversion happens at registration so a bad schema fails at boot with the tool's name on it, not as a 500 on the first `initialize`. In that converter, **`const`/`enum`/combinators must be checked before the `type` switch**: TypeBox emits `Type.Literal('a')` as `{const: 'a', type: 'string'}`, so dispatching on `type` first silently turns every literal, literal union and enum into a bare `z.string()` — no validation, and the allowed values never reach the model. Likewise an object with no `properties` (which is how `Type.Record` and `Type.Date` come out) must not become `z.object({})`, which strips every key. If a TypeBox construct produces the wrong MCP input schema, the bug is almost certainly in there — and it will be silent.
- `ToolResponse` shapes are mapped onto MCP content blocks by `transformToMcpResponse`. MCP's `ImageContent` is flat (`{type, data, mimeType}`, raw base64 — no `data:` URI) and `EmbeddedResource` carries binary under `blob`, not `data`. Getting these wrong produces content no client can read, and nothing type-checks it, so [units.test.ts](test/units.test.ts) validates the output against the SDK's own schemas.
- Tool names are made type-safe by module augmentation: host apps declare `interface McpToolMap { [MY_TOOL_NAME]: InferMcpToolType<MyTool> }` inside `declare module 'feathers-mcp'`. This only merges because `McpToolMap` is re-exported from `src/index.ts`.

**Calling other services from a tool.** Always forward the handler's `params`. A service call with no params is an *internal* call — `params.provider` is undefined — and every authorization hook written the usual way (`if (context.params.provider)`) is skipped, `authenticate()` included. Since a tool's arguments come from the model, dropping params turns any id argument into an IDOR. `BaseTool.resourceFromUploadId` shipped exactly that bug and now requires params.

**Host-app coupling.** The library assumes services exist in the host app: `mcp-api-keys` (id = the API key, fields `isActive`, `userId` — all overridable via `McpApiKeyStrategy` options) and the `authentication.service` entity service, plus `uploads` (`signedUrl`, `originalName`) in `BaseTool.resourceFromUploadId()`.

## Conventions

- ESM-only source (`"type": "module"`); **relative imports must carry the `.js` extension** (`NodeNext`) even though the files are `.ts`.
- `McpApplication` is `Application<any, any>`, deliberately **not** a `KoaApplication | ExpressApplication` union: TypeScript cannot call `.use()` on that union (the overload sets are incompatible), which forced `any` casts at every call site here and in host apps. Build-the-app code that needs `app.use(middleware)` uses the concrete framework type; everything the library touches uses `McpApplication`.
- The public API surface is exactly the export list in [src/index.ts](src/index.ts). Anything a host app needs — including types it must augment — has to be re-exported there.
- `@feathersjs/*` and `@modelcontextprotocol/sdk` are **peer** dependencies (the host app provides them); `zod` is a real dependency because `src/` imports it directly, and its range is `^3.25 || ^4.0` to mirror the SDK's — narrowing it would force a zod major on hosts. The suite is green on both. If you add an import of a new package, declare it — several were previously resolving only through hoisting.
- Logging is opt-in via `DEBUG=feathers-mcp` ([logger.ts](src/mcp/logger.ts)). A library has no business writing to a host app's stdout by default; don't reintroduce bare `console.log`.
- `bun` is the package manager (`bun.lock`), not npm.
