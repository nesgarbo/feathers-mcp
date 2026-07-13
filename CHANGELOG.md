# Changelog

All notable changes to this project are documented here.
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- Build moved from tsup to [tsdown](https://tsdown.dev). Faster, and it drops the
  `rollup-plugin-dts` dependency that was the reason TypeScript had to stay on 5.x.
- **`exports` map fixed.** It pointed `import` at `./dist/index.js`, which the new build does not
  emit — and, more quietly, it carried a single top-level `types` field, so a CJS consumer under
  NodeNext resolved the wrong declarations. Each condition now names its own declaration file. The
  packed tarball is now actually `require()`d and `import()`ed as part of verification; a broken
  `exports` map fails no build.

### Notes

- TypeScript is still pinned to 5.x, but the blocker has changed: build, typecheck and tests all
  pass under TS 7 now, and the emitted declarations are equivalent. What breaks is
  **typescript-eslint**, whose `typescript-estree` uses TS internals that TS 7 removed.

## [2.0.0]

A correctness and security release. Several of the fixes below change behaviour, hence the major.

### Security

- **`BaseTool.resourceFromUploadId` was an IDOR.** It called `uploads.get(id)` with no `params`,
  which makes it an *internal* Feathers call: `params.provider` is undefined, so every authorization
  hook written the standard way (`if (context.params.provider)`) is skipped — `authenticate()`
  included. Since the upload id comes from the model, any caller could name any other user's upload
  and receive its contents. The helper now takes the handler's `params` and refuses to run without
  them.
- **A single shared `McpServer` leaked identities across concurrent sessions.** The SDK's
  `Protocol.connect()` keeps one `_transport` slot and overwrites it on each connect, so it defined
  `extra.sessionId` for *every* session as whichever connected last. With two clients, A's tool call
  could execute with B's authenticated user. Each session now gets its own `McpServer`, and sessions
  are bound to the principal that opened them (403 if another user presents the id).
- **Rejected tool calls retained the caller's params, including the raw API key.** Cleanup lived only
  inside the tool callback, which the SDK never invokes when the tool name is unknown or the input
  fails schema validation. Every such call pinned the user object and the `Authorization` header for
  the life of the session; a client looping `callTool({name: 'nope'})` grew the heap without bound.
- **Literals and enums were not validated at all.** TypeBox emits `Type.Literal('a')` as
  `{const: 'a', type: 'string'}`, and the converter dispatched on `type` first — so every literal,
  literal union and `Type.Enum` became a bare `z.string()`. A `Type.Union([Literal('read'),
  Literal('write')])` discriminator accepted any string, and the allowed values never reached the
  model in the advertised schema.
- **`signedUrlToBase64` buffered responses with no size cap**, so one oversized upload could take the
  process down. It now enforces a 25 MB limit (`DEFAULT_MAX_BYTES`).
- **`McpApiKeyStrategy` reported infrastructure failures as invalid keys.** `.catch(() => undefined)`
  turned a database outage into `Forbidden('Invalid API key')`, hiding the outage from whoever had to
  fix it. Only `NotFound` is now treated as a bad key.
- Sessions had neither an idle timeout nor a count cap. The MCP client does not send DELETE on a
  plain `close()` — only on `terminateSession()` — so `transport.onclose` never fires on an ordinary
  disconnect and sessions accumulated for the life of the process.

### Fixed

- **The standalone SSE stream never worked.** MCP `GET`s the bare endpoint, which Feathers maps to
  `find`, not `get` — and only `create`/`get` were registered, so the stream returned 405. `find` and
  `remove` (DELETE session termination) are now registered.
- **Express was broken.** The transport middleware wrote `expressRequest`/`expressResponse` onto
  params while the service read `params.req`/`params.res`. Express is now covered by the integration
  suite alongside Koa.
- **An auth failure under Koa hung the client.** `ctx.respond = false` was set before the service ran,
  which also gagged Koa's error handler, so the 401 was never sent. It is now set only after the
  transport has actually written to the socket.
- **Notifications used a method that does not exist.** MCP logging is `notifications/message`, not
  `notifications/log`. Notifications are also routed through the SDK's `extra.sendNotification`, so
  they reach the stream of the call that produced them rather than a standalone SSE stream a
  POST-only client never opens — progress updates previously went nowhere.
- **`Type.Record` and `Type.Date` silently discarded all data.** They emit an object schema with no
  `properties`, which became `z.object({})` — a schema that strips every unknown key. Handlers
  received `{}` with no error and no warning.
- **`Type.Tuple` lost its positional types**, degrading to `z.array(z.any())`.
- **`allowMcpApiKey` blindly did `.substring(7)`** on the auth header, mangling any non-`Bearer`
  scheme into a garbage key seven characters short.
- **`authentication.mcpApiKey.header` was a trap.** Configuring anything but `Authorization` (say,
  `x-api-key`) still demanded a `Bearer ` prefix, so every request 401'd. A custom header now carries
  the key bare.
- **Duplicate tool names silently overwrote each other**, leaving the shadowed tool registered but
  unreachable. Registration now throws.
- **`expose.openai` did nothing.** `getToolcallSchema()` and `buildToolsSchema()` filtered on
  `expose.mcp`, putting exactly the wrong tools in the OpenAI schema.
- **`uniqueItems` discarded `minItems`/`maxItems`** on the same array schema.
- A malformed tool schema surfaced as a 500 on the first client's `initialize`. Schemas are now
  converted at registration, so it fails at boot with the tool's name on it.
- A transient error on one request no longer evicts an otherwise healthy session.

### Changed (breaking)

- `resourceFromUploadId(uploadId, uri, params, appendOriginalName?)` — `params` inserted as the third
  argument, and required.
- Content blocks now match the MCP spec: `image` is flat (`{type, data, mimeType}`) with **raw
  base64**, no `data:` URI prefix; a resource's payload travels as `blob`, not `data`. Nothing could
  read the old shapes.
- `structuredContent` is the JSON result itself, not a `{ result: … }` wrapper, and is omitted for a
  scalar result (the spec requires an object).
- Inputs that previously slipped past a degraded schema (any string where a literal was declared, a
  mistyped tuple) are now rejected.
- `McpApiKeyStrategy` throws `NotAuthenticated` (401) instead of `Forbidden` (403), and accepts
  optional `{ service, userIdField, activeField }` instead of hard-coding them.
- Session ownership resolves the user id through `authentication.entityId` rather than assuming
  `id`/`_id`, so hosts keyed on something else (`uuid`) work.
- `McpApplication` is `Application<any, any>` rather than a `KoaApplication | ExpressApplication`
  union. TypeScript cannot call `.use()` on that union, which forced `any` casts on every call site,
  in host apps too.
- `signedUrlToBase64` returns raw base64 instead of a `data:` URI.

### Added

- `sessionTtlMs` (default 30 min, `0` disables) and `maxSessions` (default 1000, `0` disables) on
  `feathersMcp()`.
- `serverInfo` on `feathersMcp()`, advertised to clients on `initialize`.
- Opt-in tracing via `DEBUG=feathers-mcp`. The library no longer writes to the host's stdout by
  default.
- `Params` augmentation for the raw request/response — host apps no longer declare it themselves.
- The full public surface is exported, including `McpToolMap`, which module augmentation of tool names
  needs in order to merge at all.

### Internal

- Peer dependencies are declared (`@feathersjs/*`, `@modelcontextprotocol/sdk`); `zod` is a real
  dependency. Several imports previously resolved only through hoisting.
- `zod` is ranged `^3.25 || ^4.0`, matching the SDK's own peer range so hosts are not forced onto a
  zod major. The suite is green on both.
- **TypeScript is pinned to 5.x.** TS 7's API breaks `rollup-plugin-dts` inside tsup:
  `Cannot read properties of undefined (reading 'useCaseSensitiveFileNames')`.
- The mocha/chai scaffolding (which `require`d a `lib/` that never existed) is replaced by 58 vitest
  tests, including integration tests that drive real Feathers Koa and Express apps with real MCP
  clients. `tsc --noEmit` now covers the test directory as well.
- ESLint flat config; `node_modules/` and `dist/` are no longer committed.

## [1.0.3] and earlier

See the git history.
