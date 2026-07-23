---
title: Guía rápida
description: Añade feathers-mcp a una app FeathersJS — Koa y Express se registran igual.
---

Registrar `feathers-mcp` es idéntico tanto si tu app corre en Koa como en Express — nada de los
pasos de abajo depende de cuál uses. Los dos transportes solo difieren en un par de detalles
internos (documentados al final de esta página), no en nada que tengas que hacer tú.

```bash
npm install feathers-mcp --save
```

## 1. Configura el plugin

En tu archivo de arranque principal (`src/app.ts`):

```ts
import { feathersMcp } from "feathers-mcp";
import { RepeatTextTool } from "./tools/repeat-text.tool";

app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
  })
);
```

## 2. Añade las declaraciones de MCP

En `src/declarations.ts`:

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

Ya no necesitas declarar `koaRequest`/`koaResponse` (Koa) ni `expressRequest`/`expressResponse`
(Express) tú mismo — la biblioteca aumenta `Params` con el par que corresponda a tu framework.

## 3. Configura la autenticación por API key

Eres responsable de implementar la estrategia y el servicio de autenticación para las API keys
de MCP.

**¿Ya tienes tu propia estrategia de API key/token registrada?** Sáltate `McpApiKeyStrategy`
por completo y apunta `feathersMcp()` a ella:

```ts
app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
    authStrategy: "api-key", // el nombre con el que ya registraste tu estrategia
    authField: "token", // por defecto 'apiKey' — el campo que lea tu estrategia
  })
);
```

Consulta [Opciones](/es/docs/options/) para ambos campos.

`McpApiKeyStrategy` busca la clave en un servicio indexado por la propia clave, y espera un
campo tipo `userId` y otro tipo `isActive`. **Los tres son configurables** — si ya tienes tu
propio servicio de API keys/tokens, apunta la estrategia a él en vez de crear uno segundo:

```ts
import { McpApiKeyStrategy } from "feathers-mcp";

authentication.register(
  "mcpApiKey",
  new McpApiKeyStrategy({
    service: "partner-tokens", // por defecto 'mcp-api-keys'
    userIdField: "ownerId", // por defecto 'userId'
    activeField: "enabled", // por defecto 'isActive'
  })
);
```

Solo necesita un `get(key)` que devuelva el registro correspondiente (o lance `NotFound`) — no
tiene que ser una tabla dedicada.

Si prefieres partir de la forma por defecto (`mcp-api-keys`, `userId`, `isActive`), genera el
servicio (el nombre **debe** ser `mcp-api-keys` para que apliquen los valores por defecto):

```bash
npx feathers generate service
? What is the name of your service? mcpApiKey
? Which path should the service be registered on? mcp-api-keys
? Does this service require authentication? Yes
? What database is the service using? SQL
? Which schema definition format do you want to use? TypeBox (recommended)
```

Edita la migración generada:

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

Registra la estrategia en `authentication.ts`:

```ts
import { McpApiKeyStrategy } from "feathers-mcp";

authentication.register("mcpApiKey", new McpApiKeyStrategy());
```

Añádela en `default.json`/`production.json`:

```json
"authentication": {
  "authStrategies": ["jwt", "local", "mcpApiKey"],
  "mcpApiKey": { "header": "Authorization" }
}
```

Si usas una cabecera dedicada en lugar de `Authorization`, lleva la clave a pelo:

```json
"mcpApiKey": { "header": "x-api-key" }
```

## 4. Escribe una tool

Consulta [Escribir tools](/es/docs/tools/) para la API completa de `BaseTool`.

## Koa vs. Express: qué cambia en realidad

Nada de lo anterior. Los dos únicos detalles específicos de framework son internos, y están
documentados en detalle en [Arquitectura](/es/docs/architecture/):

- **Nombres de las claves en params** — `koaRequest`/`koaResponse` bajo Koa,
  `expressRequest`/`expressResponse` bajo Express (paso 2). Nunca las lees tú mismo.
- **Cómo se le dice al framework que deje de escribir en la respuesta** una vez el transporte
  MCP ha tomado el socket — Koa activa `ctx.respond = false`; Express detiene la cadena de
  middleware en cuanto `res.headersSent`. Ninguno de los dos requiere nada de ti.

Ambos están cubiertos de extremo a extremo por los tests de integración de esta biblioteca.
