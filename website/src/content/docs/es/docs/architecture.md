---
title: Arquitectura
description: Flujo de la petición, mapeo de verbos, y el modelo de servidor por sesión detrás de feathers-mcp.
---

## Mapeo de verbos

MCP hace POST de cada mensaje JSON-RPC, GET al endpoint desnudo para el stream SSE
independiente, y DELETE para terminar la sesión. En Feathers un GET sin id mapea a `find`, **no**
a `get` — así que el stream SSE cae en `find`. Registrar solo `create`/`get` deja el stream SSE
devolviendo 405.

## Flujo de la petición

1. **Traspaso del socket crudo.** El middleware del transporte guarda el `req`/`res` crudo de
   Node en `params` (`koaRequest`/`koaResponse` bajo Koa, `expressRequest`/`expressResponse`
   bajo Express); `getRawHttp()` los recupera dentro del servicio. Las dos mitades tienen que
   coincidir en los nombres de las claves — bajo Express no coincidían en silencio durante un
   tiempo, que es por lo que Express nunca funcionó hasta arreglarse.
2. **Decirle al framework que no toque el socket.** Bajo Koa, `ctx.respond = false` se activa
   **solo después de `await next()` y solo si `res.headersSent`** — activarlo de antemano
   también silencia el manejador de errores de Koa, así que un fallo de autenticación (que
   ocurre antes de que el transporte vea la petición) colgaría al cliente en vez de devolver
   401. Express no tiene un flag equivalente, así que un middleware `after` detiene la cadena en
   cuanto `headersSent` es verdadero, para que el formateador REST no pueda poner cabeceras en
   una respuesta ya enviada.
3. **Hooks.** `allowMcpApiKey()` extrae una clave `Bearer` de la cabecera configurada y
   reescribe `params.authentication` a la estrategia `mcpApiKey`; luego corre
   `authenticate('mcpApiKey')`. Cada llamada MCP es por tanto una llamada Feathers autenticada,
   y los handlers de tools reciben un `params.user` real.

## Sesiones

**Un `McpServer` por sesión, nunca compartido.** `Protocol.connect()` del SDK mantiene un único
slot `_transport` y lo sobrescribe en cada conexión — su propio docstring dice que asume
propiedad exclusiva. Un servidor compartido entre sesiones enrutaría cada respuesta, y cada
`extra.sessionId`, hacia quien conectó *último*. Los callbacks de tools capturan su propia
sesión; deliberadamente no existe una búsqueda por session-id dentro de un handler. Las sesiones
también están atadas al principal que las abrió (resuelto vía `authentication.entityId`, no un
`id` hardcodeado), así que un usuario válido pero distinto no puede manejar la sesión de otro.

Dentro de una misma sesión, un handler recibe los params de **su propia** petición mediante un
mapa indexado por el id de la petición, no un único `session.params` mutable — pueden haber
varias llamadas en vuelo a la vez. Ese mapa se limpia pase lo que pase con el callback de la
tool: el SDK se salta el callback por completo ante un nombre de tool desconocido o un fallo de
validación de esquema, y cada llamada saltada dejaría fijados en memoria los params del llamante
— incluida la clave API cruda — durante toda la vida de la sesión.

Las sesiones se recolectan por TTL de inactividad y por un tope de cantidad, ambos aplicados de
forma **perezosa** — se barren en cada petición, nunca con un timer, porque una biblioteca no
tiene por qué mantener un intervalo abierto en el event loop de la app anfitriona. El cliente
MCP **no** envía DELETE en un `close()` normal — solo en `terminateSession()` — así que el TTL de
inactividad es lo único que libera esas sesiones. Las sesiones viven en memoria del proceso, así
que esto no escala horizontalmente sin sesiones pegajosas (sticky sessions).

Los errores se escriben directo en la respuesta cruda, porque bajo el `respond = false` de Koa
cualquier cosa que el servicio *devuelva* se descarta en silencio.

## Tools

- `BaseTool` es el punto de extensión: `name`, `description`, `inputSchema`/`outputSchema` en
  TypeBox, `expose` (`{ mcp, openai }`), y `handler(input, params, emit)`.
- `McpToolHandler` es el registro, colgado de la app en `app.get('mcpToolHandler')`. `expose` es
  estático y global — toda clave autenticada ve la misma lista de tools, así que la
  autorización por usuario va en hooks de Feathers sobre los servicios que llama un handler, no
  aquí.
- **Los esquemas son TypeBox en la frontera de autor, Zod en la frontera del SDK.** El tipo de
  esquema del SDK de MCP no acepta JSON Schema crudo, así que un conversor traduce TypeBox a Zod
  a mano en el registro — un esquema mal formado falla al arrancar con el nombre de la tool
  adjunto, no como un 500 en el primer `initialize`.

Consulta [Escribir tools](/es/docs/tools/) para la API completa de autoría de tools, y
[Sesiones](/es/docs/sessions/) para el ciclo de vida de la sesión en detalle.
