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

And koaRequest and koaResponse in the declarations.ts
```ts
import { IncomingMessage, ServerResponse } from 'http'
...
declare module '@feathersjs/feathers' {
  interface Params {
    ...
    koaRequest?: IncomingMessage
    koaResponse?: ServerResponse<IncomingMessage>
  }
  ...
}
```

It is not tested in express but it is supposed to be req and res instead

4. **Example Tool**

Create your tools by extending BaseTool and defining input/output schemas:

```ts
import { Static, Type } from "@feathersjs/typebox";
import { McpParams, BaseTool, ToolResponse } from "feathers-mcp";
import type { InferMcpToolType } from "feathers-mcp";

export const REPEAT_TEXT_TOOL_NAME = "repeat_text" as const;

export class RepeatTextTool extends BaseTool<
  typeof REPEAT_TEXT_TOOL_NAME,
  typeof RepeatTextTool.inputSchema,
  typeof RepeatTextTool.outputSchema
> {
  name = REPEAT_TEXT_TOOL_NAME;
  description = "Repite un texto N veces";
  static inputSchema = Type.Object({
    text: Type.String({ description: "Texto a repetir" }),
    times: Type.Number({ description: "Número de repeticiones" }),
  });
  static outputSchema = Type.String({ description: "Texto repetido" });
  inputSchema = RepeatTextTool.inputSchema;
  outputSchema = RepeatTextTool.outputSchema;
  expose = { mcp: true, openai: true };

  async handler(
    { text, times }: { text: string; times: number },
    _ctx: McpParams,
    emit: (message: string, progress?: number) => void
  ) {
    emit("Starting text repetition...", 0);
    const result = text.repeat(times);
    emit("Text repetition in progress...", 50);
    emit("Text repetition completed!", 100);
    return { text: { type: "text", data: text.repeat(times) } } as ToolResponse<
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

You should also augment the MCP tool types by declaring your tool

---

## License

MIT License © 2025 Nesgarbo
