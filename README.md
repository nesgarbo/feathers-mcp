<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-lockup-dark.svg">
    <img src="assets/logo-lockup-light.svg" alt="feathers-mcp" width="380">
  </picture>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/feathers-mcp"><img alt="Download Status" src="https://img.shields.io/npm/dm/feathers-mcp.svg?style=flat-square"></a>
  <a href="https://feathers-mcp.nesgarbo.com/docs/"><img alt="Documentation" src="https://img.shields.io/badge/docs-feathers--mcp.nesgarbo.com-4527A6?style=flat-square"></a>
  <a href="./LICENSE"><img alt="License" src="https://img.shields.io/badge/license-MIT-f3ce6e?style=flat-square"></a>
</p>

> MCP implementation for FeathersJS — plugs a Model Context Protocol server into an existing
> FeathersJS v5 app as a regular service. Built by [nesgarbo](https://nesgarbo.com).

There is no separate process to deploy or keep in sync: `feathers-mcp` registers the MCP
transport as a normal Feathers custom service, so every tool call is a real, authenticated
Feathers call — real hooks, real `params.user`, real authorization.

**📖 Full documentation, in English and Spanish, lives at
[feathers-mcp.nesgarbo.com](https://feathers-mcp.nesgarbo.com/docs/)** — architecture,
a quickstart, a tool-authoring guide, the session model, and the
upgrade notes from 1.x. This README stays intentionally shorter than the docs site; it's the
"am I in the right place" overview, not the reference.

## Installation

```bash
npm install feathers-mcp --save
```

## Integration Steps

1. **Configure the plugin**:

In your main setup file (e.g., src/app.ts or src/app.js):

```ts
import { feathersMcp } from "feathers-mcp";
import { RepeatTextTool } from "./tools/repeat-text.tool";

app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
  })
);
```

This registers the MCP server and your custom tools.

2. **Add MCP declarations**:  
   In you src/declarations.ts file:

```ts
import type { McpToolHandler, McpServerService } from "feathers-mcp";
import { mcpServerPath } from "feathers-mcp";

export interface Configuration extends ApplicationConfiguration {
  mcpToolHandler: McpToolHandler;
}

export interface ServiceTypes {
  [mcpServerPath]: McpServerService;
}
```

This ensures TypeScript recognizes mcpToolHandler and the mcp-server service.

3. **Setup the API Key Authentication**:

You are responsible for implementing the authentication strategy and service for MCP API Keys.

**Already have your own API-key/token authentication strategy registered?** You don't need to
register this library's `McpApiKeyStrategy` at all — point `feathersMcp()` at your existing
strategy instead:

```ts
app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
    authStrategy: "api-key", // the name you already registered your strategy under
    authField: "token", // defaults to 'apiKey' — whatever field your strategy reads
  })
);
```

`allowMcpApiKey()` extracts the key from the configured header and drives `authenticate(authStrategy)`
with `{ strategy: authStrategy, [authField]: key }` — your existing strategy runs exactly as it
would for any other authenticated request, and this library never sees `mcp-api-keys`.

**Don't have one yet, but want to use this library's strategy against your own key/token
service?** `McpApiKeyStrategy` looks up the key in a service, keyed by the key itself
(`.get(apiKey)`), and expects a `userId`-like field and an `isActive`-like field on the record.
**All three are overridable** — point it at your own service instead of creating a second one:

```ts
import { McpApiKeyStrategy } from "feathers-mcp";

authentication.register(
  "mcpApiKey",
  new McpApiKeyStrategy({
    service: "partner-tokens", // defaults to 'mcp-api-keys'
    userIdField: "ownerId", // defaults to 'userId'
    activeField: "enabled", // defaults to 'isActive'
  })
);
```

Whatever service you point it at just needs a `get(key)` that returns the matching record (or
throws `NotFound`) — it doesn't need to be a dedicated table; a hook-adapted view over an
existing one works too.

If you'd rather start from scratch, here's the default shape (`mcp-api-keys`, `userId`,
`isActive`) end to end:

- Create the mcp-api-keys service.
- Register mcpApiKey strategy in authentication.ts.

Do this:

```bash
npx feathers generate service
? What is the name of your service? mcpApiKey
? Which path should the service be registered on? mcp-api-keys
? Does this service require authentication? Yes
? What database is the service using? SQL
? Which schema definition format do you want to use? Schemas allow to type,
validate, secure and populate data TypeBox  (recommended)
    Updated src/client.ts
    Wrote file src/services/mcp-api-keys/mcp-api-keys.schema.ts
    Wrote file src/services/mcp-api-keys/mcp-api-keys.ts
    Updated src/services/index.ts
    Wrote file src/services/mcp-api-keys/mcp-api-keys.shared.ts
    Wrote file test/services/mcp-api-keys/mcp-api-keys.test.ts
    Wrote file src/services/mcp-api-keys/mcp-api-keys.class.ts
    Wrote file migrations/20250528115613_mcp-api-key.ts
```

Edit the migration

```ts
await knex.schema.createTable("mcp_api_keys", (table) => {
  table.uuid("id").primary();
  table
    .integer("userId")
    .references("id")
    .inTable("users")
    .onDelete("CASCADE")
    .notNullable();
  table.string("description").notNullable().defaultTo("");
  table.boolean("isActive").notNullable().defaultTo(true);
  table.timestamp("createdAt", { useTz: true });
  table.timestamp("updatedAt", { useTz: true });
});
```

Add the authStrategy in authentication.ts

```ts
import { McpApiKeyStrategy } from 'feathers-mcp'
...
authentication.register('mcpApiKey', new McpApiKeyStrategy())
```

Add the authStrategy in default.json & production.json

```json
"authentication": {
  ...
  "authStrategies": [
    "jwt",
    "local",
    "mcpApiKey"
  ],
  ...
  "mcpApiKey": {
    "header": "Authorization"
  }
}
```

The MCP transport writes to the raw Node socket, so `feathers-mcp` passes it through Feathers params.
You no longer need to declare `koaRequest`/`koaResponse` yourself — the library augments `Params`.

Registration is identical on Koa and Express — both are covered end-to-end by the integration
tests. See the [quickstart](https://feathers-mcp.nesgarbo.com/docs/quickstart/) for the couple of
internal details that do differ between the two.

If you use a dedicated header rather than `Authorization`, it carries the key bare:

```json
"mcpApiKey": { "header": "x-api-key" }
```

4. **Example Tool**

Create your tools by extending BaseTool and defining input/output schemas:

```ts
import { Static, Type } from "@feathersjs/typebox";
import { McpParams, BaseTool, ToolResponse } from "feathers-mcp";
import type { EmitFunction, InferMcpToolType } from "feathers-mcp";

export const REPEAT_TEXT_TOOL_NAME = "repeat_text" as const;

export class RepeatTextTool extends BaseTool<
  typeof REPEAT_TEXT_TOOL_NAME,
  typeof RepeatTextTool.inputSchema,
  typeof RepeatTextTool.outputSchema
> {
  name = REPEAT_TEXT_TOOL_NAME;
  description = "Repite un texto N veces";
  // The input schema must be a Type.Object — MCP tool inputs are always objects.
  static inputSchema = Type.Object({
    text: Type.String({ description: "Texto a repetir" }),
    times: Type.Number({ description: "Número de repeticiones" }),
  });
  static outputSchema = Type.String({ description: "Texto repetido" });
  inputSchema = RepeatTextTool.inputSchema;
  outputSchema = RepeatTextTool.outputSchema;
  expose = { mcp: true, openai: true };

  async handler(
    { text, times }: Static<typeof RepeatTextTool.inputSchema>,
    // The authenticated Feathers params of the caller, including `params.user`.
    params: McpParams,
    emit: EmitFunction
  ) {
    emit("Starting text repetition...", 0);
    const result = text.repeat(times);
    emit("Text repetition completed!", 100);
    return { text: { type: "text", data: result } } as ToolResponse<
      Static<typeof RepeatTextTool.outputSchema>
    >;
  }
}

declare module "feathers-mcp" {
  interface McpToolMap {
    [REPEAT_TEXT_TOOL_NAME]: InferMcpToolType<RepeatTextTool>;
  }
}
```

You should also augment the MCP tool types by declaring your tool.

`emit` sends notifications to the client while the call is still running. A bare number is progress;
pass an object for anything else:

```ts
emit("Halfway", 50);                                  // progress notification
emit("Halfway", { progress: 50, total: 200 });        // progress out of a custom total
emit("Fetching rows", { type: "log", level: "info" }); // log notification
```

## Return values

A tool returns any combination of `text`, `json`, `image` and `resource`. Binary payloads are
**raw base64** — no `data:` URI prefix:

```ts
return { image: { type: "image", data: base64, mimeType: "image/png" } };
return { json: { type: "json", result: { rows } } };
```

## Options

```ts
app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
    serverInfo: { name: "my-app", version: "2.0.0" }, // advertised on initialize
    sessionTtlMs: 30 * 60 * 1000, // idle session timeout; 0 disables
    maxSessions: 1000, // concurrent session ceiling; 0 disables
  })
);
```

## Debugging

Session and tool tracing is off by default. Turn it on with:

```bash
DEBUG=feathers-mcp node app.js
```

## Notes

- Each MCP session gets its own `McpServer` and is bound to the user that opened it; another user
  presenting the same session id is rejected with 403.
- Sessions are held in process memory, so running more than one instance requires sticky sessions.
- Tool input schemas must be a `Type.Object`, and two tools may not share a name — both fail at boot.

Upgrading from 1.x? See [CHANGELOG.md](CHANGELOG.md) — 2.0.0 carries breaking changes, or the
[upgrade guide](https://feathers-mcp.nesgarbo.com/docs/upgrading/) on the docs site.

---

## License

MIT License © 2025 Nesgarbo
