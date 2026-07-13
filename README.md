# feathers-mcp

[![Download Status](https://img.shields.io/npm/dm/feathers-mcp.svg?style=flat-square)](https://www.npmjs.com/package/feathers-mcp)

> MCP implementation for FeathersJS

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

You must:

- Create the mcp-api-keys service. _Name must be mcp-api-keys_
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

Both Koa and Express are covered by the integration tests.

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

A tool returns any combination of `text`, `json`, `image` and `resource`. Binary payloads are **raw
base64** — no `data:` URI prefix:

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

Upgrading from 1.x? See [CHANGELOG.md](CHANGELOG.md) — 2.0.0 carries breaking changes.

---

## License

MIT License © 2025 Nesgarbo
