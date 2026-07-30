---
title: Opciones
description: Las opciones que acepta feathersMcp() — tools, serverInfo, authStrategy, authField.
---

```ts
import { feathersMcp } from "feathers-mcp";

app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
    serverInfo: { name: "my-app", version: "2.0.0" },
  })
);
```

| Opción | Por defecto | Efecto |
| --- | --- | --- |
| `tools` | `[]` | Clases de tools a instanciar y registrar al arrancar. |
| `serverInfo` | nombre/versión de la propia biblioteca | Lo que el servidor MCP anuncia a los clientes: en `initialize` en la era 2025, en `server/discover` en la de 2026. |
| `authStrategy` | `'mcpApiKey'` | Estrategia de autenticación de Feathers registrada que corre en cada llamada MCP. Apúntala a una estrategia que tu app ya tenga en vez de registrar `McpApiKeyStrategy`. |
| `authField` | `'apiKey'` | Propiedad bajo la que se coloca el valor de la cabecera extraído en el objeto de la petición de autenticación. Solo importa cuando `authStrategy` apunta a una estrategia preexistente que espera un campo distinto. |

## Eliminadas en 3.0.0

| Opción | Estado |
| --- | --- |
| `sessionTtlMs` | No hace nada. Se acepta y se ignora, con un aviso bajo `DEBUG=feathers-mcp`. |
| `maxSessions` | No hace nada. Igual. |

El servicio no tiene estado — no hay sesiones que expirar ni topar. Se siguen aceptando para que
una llamada a `feathersMcp()` existente no se rompa al actualizar, pero deberías borrarlas.
Consulta [Sin estado](/es/docs/sessions/).
