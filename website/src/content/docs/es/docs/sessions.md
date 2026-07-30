---
title: Sin estado
description: No hay sesiones. Cada petición se autentica y se sirve por sí sola.
---

**No hay sesiones.** Desde 3.0.0, `feathers-mcp` sirve MCP sin estado: un único
`createMcpHandler` construye un `McpServer` nuevo por cada petición HTTP, cuyos callbacks de
tools capturan los params de Feathers *de esa petición*.

Es el modelo para el que se diseñó MCP `2026-07-28`, y elimina una clase entera de problemas en
vez de gestionarla.

## Qué desapareció, y por qué ya no importa

| 2.x | 3.0.0 |
| --- | --- |
| Un mapa de sesiones en memoria del proceso | No se retiene nada entre peticiones |
| TTL de inactividad (`sessionTtlMs`) barriendo sesiones muertas | No hay nada que expirar |
| Tope de sesiones (`maxSessions`) limitando la reserva de memoria | No hay nada que topar |
| Comprobación de `ownerId` rechazando un id de sesión de otro usuario | No hay id de sesión que presentar |
| Un mapa de params por petición, barrido en un `finally` para que una llamada rechazada no dejara fijada la clave API del llamante | Los params son un closure sobre una petición, y se recolectan con ella |
| Sticky sessions obligatorias para correr más de una instancia | Cualquier instancia puede servir cualquier petición |

Cada una de esas piezas existía solo para hacer segura la operación *con sesiones*. La forma por
petición da las mismas garantías gratis — un handler no puede alcanzar el contexto de otro
llamante porque nunca tuvo una referencia a él.

## La identidad sigue viajando en cada llamada

La autenticación no ha cambiado. `allowMcpApiKey()` más `authenticate()` siguen corriendo como
hooks de Feathers en cada petición MCP, así que o la petición trae una clave válida o nunca llega
al servicio. Tu handler de tool sigue recibiendo un `params.user` real.

La diferencia es que ahora eso es lo *único* que establece la identidad. En 2.x una petición podía
presentar un id de sesión y heredar la identidad detrás de él; ahora cada petición demuestra quién
es.

## Los dos verbos que cambian

GET (el stream SSE independiente de la era 2025) y DELETE (terminación de sesión de la era 2025)
son operaciones de sesión. Sin estado, ambos responden **405**.

Nada en esta biblioteca usaba el stream independiente: las notificaciones de una tool salen por el
stream de la llamada que las produjo, etiquetadas con su id de petición. Si dependías del stream
GET directamente, el reemplazo moderno es `subscriptions/listen`.

## Opciones que ahora no hacen nada

`sessionTtlMs` y `maxSessions` se aceptan y se ignoran, con un aviso bajo `DEBUG=feathers-mcp`,
para que las llamadas a `feathersMcp()` existentes no se rompan. Quítalas.

Consulta [Arquitectura](/es/docs/architecture/) para ver cómo llega una petición a un handler de
tool, y [Actualizar](/es/docs/upgrading/) para el delta completo de 3.0.0.
