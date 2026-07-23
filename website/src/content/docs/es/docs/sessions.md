---
title: Sesiones
description: Un McpServer por sesión, atado al usuario que la abrió, recolectado por TTL de inactividad.
---

**Un `McpServer` por sesión, nunca compartido.** `Protocol.connect()` del SDK de MCP mantiene un
único slot `_transport` y lo sobrescribe en cada conexión — su propio docstring dice que asume
propiedad exclusiva. Un servidor compartido entre sesiones enrutaría cada respuesta, y cada
`extra.sessionId`, hacia quien conectó *último*: con dos llamantes concurrentes, la tool call
del llamante A se ejecutaría como el usuario autenticado del llamante B.

Los callbacks de tools capturan su propio objeto de sesión. Deliberadamente no existe una
búsqueda por session-id dentro de un handler — el handler simplemente no puede alcanzar el
estado de otra sesión, por construcción, no por convención.

## Propiedad

Las sesiones están atadas al principal que las abrió (`ownerId`, resuelto vía
`authentication.entityId` — no un campo `id` hardcodeado). Una petición que presenta un id de
sesión válido pero perteneciente a un usuario autenticado *distinto* se rechaza con 403, en vez
de adjuntarse a esa sesión en silencio.

## Params por petición, no por sesión

Dentro de una misma sesión, pueden haber varias tool calls en vuelo a la vez. Un handler recibe
los params de **su propia** petición mediante un mapa indexado por el id de la petición — no un
único `session.params` mutable que la siguiente llamada concurrente pisaría.

Ese mapa se limpia en un `finally`, no solo desde dentro del callback de la tool: el SDK de MCP
se salta el callback por completo ante un nombre de tool desconocido o un fallo de validación de
esquema. Sin el `finally`, cada llamada saltada dejaría fijados en memoria los params del
llamante — el objeto de usuario *y* la clave API cruda de la cabecera de auth — durante toda la
vida de la sesión. Un cliente que llame en bucle a un nombre de tool desconocido haría crecer sin
límite la huella de memoria de la sesión.

## Ciclo de vida

Las sesiones se recolectan de dos formas, ambas aplicadas de forma **perezosa** — se barren en
cada petición, nunca con un timer, porque una biblioteca no tiene por qué mantener un intervalo
abierto en el event loop de la app anfitriona:

- **TTL de inactividad** (`sessionTtlMs`, 30 minutos por defecto; `0` lo desactiva).
- **Tope de cantidad** (`maxSessions`, 1000 por defecto; `0` lo desactiva).

El cliente MCP **no** envía DELETE en un `close()` normal — solo en `terminateSession()` — así
que `transport.onclose` nunca se dispara ante una desconexión ordinaria. El TTL de inactividad es
lo único que libera esas sesiones; sin él, se acumularían durante toda la vida del proceso.

Las sesiones viven en memoria del proceso. Correr más de una instancia de tu app requiere
sesiones pegajosas (sticky sessions) delante.

Consulta [Opciones](/es/docs/options/) para `sessionTtlMs`/`maxSessions`, y
[Arquitectura](/es/docs/architecture/) para cómo encajan el traspaso del socket crudo y el
modelo de sesiones.
