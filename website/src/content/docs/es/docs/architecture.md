---
title: Arquitectura
description: Flujo de la petición, mapeo de verbos, y el modelo sin estado de un servidor por petición detrás de feathers-mcp.
---

## Dos eras de protocolo, un endpoint

El servicio mantiene un único handler HTTP de MCP (`createMcpHandler` de
`@modelcontextprotocol/server` v2, adaptado a Node con `toNodeHandler`). Clasifica cada petición
por su propio contenido:

- **Moderna** (`2026-07-28`) — la petición lleva el sobre `_meta` por petición, más las cabeceras
  `MCP-Protocol-Version` y `Mcp-Method` (enrutable). Se sirve de forma nativa, incluido
  `server/discover`.
- **Antigua** (`2025-11-25` y anteriores) — todo lo demás. Se sirve sin estado: una instancia
  nueva responde a cada petición, y el handshake `initialize` sigue funcionando exactamente como
  espera un cliente de la era 2025.

Los clientes sobre el retirado `@modelcontextprotocol/sdk` v1 — que es lo que todavía embarca la
mayoría de apps anfitrionas — siguen funcionando sin tocar nada.

## Mapeo de verbos

MCP hace POST de cada mensaje JSON-RPC en ambas eras. GET (el stream SSE independiente de la era
2025) y DELETE (terminación de sesión de la era 2025) son operaciones de sesión, y sin estado
responden **405**. En Feathers un GET sin id mapea a `find`, **no** a `get`, así que un GET cae en
`find`; los cuatro verbos se registran y se reenvían igualmente, para que el rechazo sea el del
propio SDK de MCP y no un 404 de Feathers.

## Flujo de la petición

1. **Traspaso del socket crudo.** El middleware del transporte guarda el `req`/`res` crudo de
   Node en `params` (`koaRequest`/`koaResponse` bajo Koa, `expressRequest`/`expressResponse`
   bajo Express); `getRawHttp()` los recupera dentro del servicio. Las dos mitades tienen que
   coincidir en los nombres de las claves — bajo Express no coincidían en silencio durante un
   tiempo, que es por lo que Express nunca funcionó hasta arreglarse.
2. **Decirle al framework que no toque el socket.** Bajo Koa, `ctx.respond = false` se activa
   **solo después de `await next()` y solo si `res.headersSent`** — activarlo de antemano
   también silencia el manejador de errores de Koa, así que un fallo de autenticación (que
   ocurre antes de que el handler vea la petición) colgaría al cliente en vez de devolver
   401. Express no tiene un flag equivalente, así que un middleware `after` detiene la cadena en
   cuanto `headersSent` es verdadero, para que el formateador REST no pueda poner cabeceras en
   una respuesta ya enviada.
3. **Hooks.** `allowMcpApiKey()` extrae una clave `Bearer` de la cabecera configurada y
   reescribe `params.authentication` a la estrategia configurada; luego corre `authenticate()`.
   Cada llamada MCP es por tanto una llamada Feathers autenticada, y los handlers de tools
   reciben un `params.user` real.

## Servicio sin estado, un servidor por petición

No hay mapa de sesiones, ni barrido por inactividad, ni tope de sesiones, ni comprobación de
propiedad de sesión. La factoría del handler corre **una vez por petición** y construye un
`McpServer` cuyos callbacks de tools capturan los params de Feathers de esa petición — así que un
handler no puede recibir el contexto de otro llamante, por construcción y no por contabilidad.

Los params llegan a la factoría a través del `authInfo` de paso del handler: el servicio pone
`req.auth`, `toNodeHandler` lo reenvía tal cual, y la factoría lo recupera en `ctx.authInfo`. Nada
del SDK de MCP lo lee, lo valida ni lo transmite.

Los esquemas de entrada de las tools se convierten **una sola vez al arrancar**, no por petición,
para que un esquema TypeBox mal formado falle al arranque con el nombre de la tool adjunto y no
como un 500 en el primer `tools/list` de alguien.

Consulta [Sin estado](/es/docs/sessions/) para qué sustituyó esto y por qué.

## Tools

- `BaseTool` es el punto de extensión: `name`, `description`, `inputSchema`/`outputSchema` en
  TypeBox, `expose` (`{ mcp, openai }`), y `handler(input, params, emit)`.
- `McpToolHandler` es el registro, colgado de la app en `app.get('mcpToolHandler')`. `expose` es
  estático y global — toda clave autenticada ve la misma lista de tools, así que la
  autorización por usuario va en hooks de Feathers sobre los servicios que llama un handler, no
  aquí.
- **Los esquemas son TypeBox en la frontera de autor, Zod en la frontera del SDK.** El tipo de
  esquema del SDK de MCP no acepta JSON Schema crudo, así que un conversor traduce TypeBox a Zod
  a mano.

Consulta [Escribir tools](/es/docs/tools/) para la API completa de autoría de tools.
