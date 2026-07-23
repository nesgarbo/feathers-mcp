---
title: Opciones
description: Las opciones que acepta feathersMcp() — serverInfo, sessionTtlMs, maxSessions.
---

```ts
import { feathersMcp } from "feathers-mcp";

app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
    serverInfo: { name: "my-app", version: "2.0.0" }, // se anuncia en initialize
    sessionTtlMs: 30 * 60 * 1000, // timeout de sesión inactiva; 0 lo desactiva
    maxSessions: 1000, // tope de sesiones concurrentes; 0 lo desactiva
  })
);
```

| Opción | Por defecto | Efecto |
| --- | --- | --- |
| `tools` | `[]` | Clases de tools a instanciar y registrar al arrancar. |
| `serverInfo` | nombre/versión de la propia biblioteca | Lo que el servidor MCP anuncia a los clientes en `initialize`. |
| `sessionTtlMs` | 30 minutos | Timeout de inactividad antes de descartar una sesión. `0` desactiva la expiración por completo. |
| `maxSessions` | 1000 | Tope de sesiones concurrentes. `0` desactiva el límite. |
| `authStrategy` | `'mcpApiKey'` | Estrategia de autenticación de Feathers registrada que corre en cada llamada MCP. Apúntala a una estrategia que tu app ya tenga en vez de registrar `McpApiKeyStrategy`. |
| `authField` | `'apiKey'` | Propiedad bajo la que se coloca el valor de la cabecera extraído en el objeto de la petición de autenticación. Solo importa cuando `authStrategy` apunta a una estrategia preexistente que espera un campo distinto. |

Tanto `sessionTtlMs` como `maxSessions` se aplican de forma perezosa — se barren en cada
petición, no con un timer — ya que las sesiones viven en memoria del proceso y una biblioteca no
debería mantener un intervalo abierto en el event loop de la app anfitriona. Consulta
[Sesiones](/es/docs/sessions/) para entender por qué el TTL es lo **único** que libera una
sesión ante una desconexión normal del cliente.
