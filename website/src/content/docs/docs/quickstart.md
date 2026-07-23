---
title: Quickstart
description: Add feathers-mcp to a FeathersJS app — Koa and Express register identically.
---

Registering `feathers-mcp` is identical whether your app runs on Koa or Express — nothing about
the steps below depends on which one you're using. The two transports differ only in a couple of
internal details (documented at the end of this page), not in anything you have to do.

```bash
npm install feathers-mcp --save
```

## 1. Configure the plugin

In your main setup file (`src/app.ts`):

```ts
import { feathersMcp } from "feathers-mcp";
import { RepeatTextTool } from "./tools/repeat-text.tool";

app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
  })
);
```

## 2. Add MCP declarations

In `src/declarations.ts`:

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

You no longer need to declare `koaRequest`/`koaResponse` (Koa) or
`expressRequest`/`expressResponse` (Express) yourself — the library augments `Params` with
whichever pair matches your framework.

## 3. Set up API key authentication

You are responsible for implementing the authentication strategy and service for MCP API keys.

**Already have your own API-key/token strategy registered?** Skip `McpApiKeyStrategy` entirely
and point `feathersMcp()` at it:

```ts
app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
    authStrategy: "api-key", // the name you already registered your strategy under
    authField: "token", // defaults to 'apiKey' — whatever field your strategy reads
  })
);
```

See [Options](/docs/options/) for both fields.

`McpApiKeyStrategy` looks up the key in a service keyed by the key itself, and expects a
`userId`-like field and an `isActive`-like field. **All three are overridable** — if you already
have your own API-key/token service, point the strategy at it instead of creating a second one:

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

It just needs a `get(key)` that returns the matching record (or throws `NotFound`) — it doesn't
have to be a dedicated table.

If you'd rather start from the default shape (`mcp-api-keys`, `userId`, `isActive`), generate the
service (name **must** be `mcp-api-keys` for the defaults to apply):

```bash
npx feathers generate service
? What is the name of your service? mcpApiKey
? Which path should the service be registered on? mcp-api-keys
? Does this service require authentication? Yes
? What database is the service using? SQL
? Which schema definition format do you want to use? TypeBox (recommended)
```

Edit the generated migration:

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

Register the strategy in `authentication.ts`:

```ts
import { McpApiKeyStrategy } from "feathers-mcp";

authentication.register("mcpApiKey", new McpApiKeyStrategy());
```

Add it to `default.json`/`production.json`:

```json
"authentication": {
  "authStrategies": ["jwt", "local", "mcpApiKey"],
  "mcpApiKey": { "header": "Authorization" }
}
```

If you use a dedicated header rather than `Authorization`, it carries the key bare:

```json
"mcpApiKey": { "header": "x-api-key" }
```

## 4. Write a tool

See [Writing tools](/docs/tools/) for the full `BaseTool` API.

## Koa vs. Express: what actually differs

Nothing above does. The only two framework-specific details are internal, and covered in full in
[Architecture](/docs/architecture/):

- **Params key names** — `koaRequest`/`koaResponse` under Koa, `expressRequest`/`expressResponse`
  under Express (step 2 above). You never read these yourself.
- **How the framework is told to stop writing to the response** once the MCP transport has taken
  over the socket — Koa sets `ctx.respond = false`; Express stops the middleware chain once
  `res.headersSent`. Neither requires anything from you.

Both are covered end-to-end by this library's own integration tests.
