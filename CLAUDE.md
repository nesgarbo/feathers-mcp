# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`feathers-mcp` is a **library** (published to npm), not an application. It plugs a Model Context Protocol server into an existing FeathersJS v5 app as a regular Feathers service. Consumers call `app.configure(feathersMcp({ tools: [...] }))`.

There is no runnable app here. The end-to-end surface is exercised by [test/test-app.ts](test/test-app.ts), which builds throwaway Feathers Koa and Express apps and drives them with real MCP clients over HTTP — that is the place to reproduce anything session- or transport-related.

## Commands

**bun**, not npm — the lockfile is `bun.lock`.

```bash
bun run build       # tsdown -> dist/ (ESM + CJS + .d.mts/.d.cts). Also runs on `prepare`.
bun run test        # vitest run
bun run dev         # vitest watch
bun run typecheck   # tsc --noEmit (covers src, test and the config files)
bun run lint        # eslint . (flat config)
```

Single test: `bunx vitest run test/units.test.ts` or `bunx vitest run -t "<test name>"`.
Trace MCP request handling: `DEBUG=feathers-mcp bun run test`.

**Do not upgrade TypeScript past 5.x**, and don't let `ncu -u` do it either. The reason has moved: it used to be that TS 7's API broke `rollup-plugin-dts` inside tsup, which tsdown does not use — build, typecheck and tests all pass on TS 7, and the emitted `.d.ts` is equivalent. The blocker now is **typescript-eslint**, whose `typescript-estree` reaches for TS internals that TS 7 removed (`Cannot read properties of undefined (reading 'Cjs')`), so `lint` dies. Recheck when typescript-eslint ships TS 7 support.

The build emits `index.mjs`/`index.cjs` with matching `.d.mts`/`.d.cts`. `package.json` `exports` must keep a `types` condition **inside each of `import` and `require`** — a single top-level `types` leaves CJS consumers under NodeNext resolving the wrong declarations. If you change the build output names, `bun pm pack` and actually `require()`/`import()` the tarball; a broken `exports` map does not fail any build.

## Architecture

The core idea: **an MCP HTTP handler is bolted onto a Feathers custom service.** The handler writes to the raw Node socket itself, so most of the design is about getting the raw request/response down to it and keeping the framework from writing over it afterwards.

**Verb mapping** ([mcp-server.shared.ts](src/mcp-server/mcp-server.shared.ts)). MCP POSTs every JSON-RPC message in both eras; GET (the 2025-era standalone SSE stream) and DELETE (2025-era session termination) are session operations that stateless serving answers `405`. In Feathers an id-less GET maps to `find`, *not* `get`, so a GET lands on `find` — all four verbs are still registered and forwarded, so the refusal is the SDK's own rather than a Feathers 404.

**Request flow** ([mcp-server.ts](src/mcp-server/mcp-server.ts))

1. Transport middleware stashes the raw Node `req`/`res` onto `params` (`koaRequest`/`koaResponse`, `expressRequest`/`expressResponse`); [app.ts](src/mcp/app.ts) `getRawHttp()` reads them back. The two halves must agree on the key names — they silently didn't, which is why Express never worked.
2. Then the framework has to be told to keep out of the socket. Koa: set `ctx.respond = false`, but **only after `await next()` and only if `res.headersSent`** — setting it up front also gags Koa's error handler, so an auth failure (which happens before the transport ever sees the request) hangs the client instead of returning 401. Express has no equivalent, so an `after` middleware stops the chain when `headersSent` so the REST formatter can't set headers on a sent response.
3. Hooks: `allowMcpApiKey()` pulls a `Bearer` key off the configured header and rewrites `params.authentication` to the configured strategy; `authenticate(strategy)` then runs. Every MCP call is therefore an authenticated Feathers call, and tool handlers get a real `params.user`. Both the strategy name and the field the key is placed under are configurable (`feathersMcp({ authStrategy, authField })`, both default to `'mcpApiKey'`/`'apiKey'`) so a host app that already has its own API-key/token strategy registered can point at it directly instead of also registering this library's `McpApiKeyStrategy`.

**Stateless, both eras, one handler** ([mcp-server.class.ts](src/mcp-server/mcp-server.class.ts)). The service holds a single `createMcpHandler(factory, { legacy: 'stateless' })` from `@modelcontextprotocol/server` v2, adapted to Node by `toNodeHandler`. It classifies each request by its own content: a 2026-07-28 request (the per-request `_meta` envelope, plus the `MCP-Protocol-Version` and routable `Mcp-Method` headers) is served modern; anything else falls to stateless legacy serving, which answers a 2025-era client with a fresh instance per request. One endpoint, both revisions, and **no sessions at all** — no session map, no idle sweep, no session cap, no `ownerId` hijacking check, no `paramsByRequest`. Each of those existed only to make sessionful serving safe; the shape now gives it for free, and the old "does not scale horizontally without sticky sessions" caveat is gone with them.

**How a tool handler gets its caller.** The factory runs once per request and its tool callbacks close over *that request's* Feathers params, so a handler cannot be handed anyone else's context. Params reach the factory through `authInfo`: `serve()` sets `req.auth` (with the params under the `feathers-mcp/params` key in `extra`), `toNodeHandler` forwards `req.auth` verbatim as the handler's pass-through `authInfo`, and `createMcpHandler` hands it back to the factory on `ctx.authInfo` — the documented hook for a factory that varies by principal. The SDK never reads, validates or transmits it. If you change either half, change both; nothing type-checks the key.

Tool input schemas are converted **in the constructor**, not in the factory: the factory runs per request, and a bad TypeBox schema has to fail at boot with the tool's name on it rather than as a 500 on someone's first `tools/list`.

Errors are written straight to the raw response with `writeJsonRpcError`, because under Koa's `respond = false` anything the service *returns* is silently dropped.

**Protocol revisions.** MCP `2026-07-28` ("modern") drops the `initialize` handshake for a stateless `server/discover`; everything up to `2025-11-25` ("legacy") is handshake-and-session. It lives in the **v2 packages** (`@modelcontextprotocol/server` + `@modelcontextprotocol/node`, peers here), not in the retired monolithic `@modelcontextprotocol/sdk` v1 — v1 tops out at `2025-11-25` and always will. Both eras are served off the one endpoint, so neither may regress. [protocol-negotiation.test.ts](test/protocol-negotiation.test.ts) holds that line from three directions: the v2 client on `versionNegotiation: { mode: 'auto' }` must select modern **without falling back**; the same client on `{ pin: '2026-07-28' }` must connect at all (pin mode fails loudly unless `server/discover` really offers the revision, so it is the assertion that the endpoint is genuinely modern rather than merely tolerant); and the **real v1 SDK client** — a devDependency for exactly this, because it is what host apps in the field actually ship — must still connect, list, call and receive progress notifications. `server/discover` is also asserted on the raw wire, because the three things that make a request modern (`_meta` envelope, `MCP-Protocol-Version`, routable `Mcp-Method`) are what a gateway in front of this endpoint has to preserve. The `DiscoverResult` field is `supportedVersions`, not `protocolVersions`.

**Tools** ([src/mcp/](src/mcp/))

- `BaseTool` is the extension point: `name`, `description`, TypeBox `inputSchema`/`outputSchema`, `expose` (`{ mcp, openai }`), and `handler(input, params, emit)`. `emit` goes out through v2's `ctx.mcpReq.notify` (v1's `extra.sendNotification`), which tags notifications with the originating request id so they reach the same stream as the tool call — sending straight down a transport targets the standalone SSE stream, which stateless serving does not have at all. The MCP logging method is `notifications/message`; `notifications/log` does not exist. `notifications/message` is deprecated by 2026-07-28 (SEP-2577) but functional for at least twelve months, and it remains the only in-band log channel a 2025-era client understands.
- `McpToolHandler` is the registry, on the app under `app.get('mcpToolHandler')`. `getForMcp()` feeds the MCP server, `getForOpenAi()` is for host apps that also want OpenAI function-calling schemas. `expose` is static and global — every authenticated key sees the same tool list, so per-user authorization belongs in Feathers hooks on the services a handler calls, not here.
- **Schemas are TypeBox at the author boundary, Zod at the SDK boundary.** The SDK's `AnySchema` is `ZodTypeAny | $ZodType` — it does *not* accept raw JSON Schema, so [typebox-to-zod.ts](src/utils/typebox-to-zod.ts) has to hand-convert. A tool input schema **must be a `Type.Object`**; conversion happens in the service constructor so a bad schema fails at boot with the tool's name on it, not as a 500 on the first request. v2's `registerTool` wants the `z.object` itself, **not** its `.shape` — a raw shape only hits a `@deprecated` overload. In that converter, **`const`/`enum`/combinators must be checked before the `type` switch**: TypeBox emits `Type.Literal('a')` as `{const: 'a', type: 'string'}`, so dispatching on `type` first silently turns every literal, literal union and enum into a bare `z.string()` — no validation, and the allowed values never reach the model. Likewise an object with no `properties` (which is how `Type.Record` and `Type.Date` come out) must not become `z.object({})`, which strips every key. If a TypeBox construct produces the wrong MCP input schema, the bug is almost certainly in there — and it will be silent.
- `ToolResponse` shapes are mapped onto MCP content blocks by `transformToMcpResponse`. MCP's `ImageContent` is flat (`{type, data, mimeType}`, raw base64 — no `data:` URI) and `EmbeddedResource` carries binary under `blob`, not `data`. Getting these wrong produces content no client can read, and nothing type-checks it, so [units.test.ts](test/units.test.ts) validates the output against the SDK's own schemas.
- Tool names are made type-safe by module augmentation: host apps declare `interface McpToolMap { [MY_TOOL_NAME]: InferMcpToolType<MyTool> }` inside `declare module 'feathers-mcp'`. This only merges because `McpToolMap` is re-exported from `src/index.ts`.

**Calling other services from a tool.** Always forward the handler's `params`. A service call with no params is an *internal* call — `params.provider` is undefined — and every authorization hook written the usual way (`if (context.params.provider)`) is skipped, `authenticate()` included. Since a tool's arguments come from the model, dropping params turns any id argument into an IDOR. `BaseTool.resourceFromUploadId` shipped exactly that bug and now requires params.

**Host-app coupling.** By default the library assumes a `mcp-api-keys` service in the host app (id = the API key, fields `isActive`, `userId` — all overridable via `McpApiKeyStrategy` options), plus the `authentication.service` entity service and `uploads` (`signedUrl`, `originalName`) in `BaseTool.resourceFromUploadId()`. `mcp-api-keys`/`McpApiKeyStrategy` specifically are only the *default* — `feathersMcp({ authStrategy })` can point at any already-registered Feathers authentication strategy instead, so a host with its own API-key/token auth doesn't need to stand up a second one.

## Conventions

- ESM-only source (`"type": "module"`); **relative imports must carry the `.js` extension** (`NodeNext`) even though the files are `.ts`.
- `McpApplication` is `Application<any, any>`, deliberately **not** a `KoaApplication | ExpressApplication` union: TypeScript cannot call `.use()` on that union (the overload sets are incompatible), which forced `any` casts at every call site here and in host apps. Build-the-app code that needs `app.use(middleware)` uses the concrete framework type; everything the library touches uses `McpApplication`.
- The public API surface is exactly the export list in [src/index.ts](src/index.ts). Anything a host app needs — including types it must augment — has to be re-exported there.
- `@feathersjs/*`, `@modelcontextprotocol/server` and `@modelcontextprotocol/node` are **peer** dependencies (the host app provides them); `zod` is a real dependency because `src/` imports it directly, and its range is `^4.4.3` — v2 requires `zod >= 4.2`, so the old `^3.25 || ^4.0` range is no longer satisfiable. `@modelcontextprotocol/client` and the retired `@modelcontextprotocol/sdk` v1 are devDependencies, used only to drive both eras from the test suite. If you add an import of a new package, declare it — several were previously resolving only through hoisting.
- Logging is opt-in via `DEBUG=feathers-mcp` ([logger.ts](src/mcp/logger.ts)). A library has no business writing to a host app's stdout by default; don't reintroduce bare `console.log`.
- `bun` is the package manager (`bun.lock`), not npm.
