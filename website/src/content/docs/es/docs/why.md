---
title: Por qué
description: El transporte de MCP escribe directo al socket — por qué eso obliga a montarlo sobre Feathers en vez de añadirlo como una ruta.
---

El transporte Streamable HTTP de MCP no se comporta como un handler HTTP normal: escribe
directamente sobre el socket crudo de Node, y espera ser dueño de ese socket durante toda la
sesión. La mayoría de frameworks web — Feathers incluido — asumen lo contrario: el framework es
dueño de la respuesta, y tu código devuelve un valor que el framework serializa.

`feathers-mcp` existe para conciliar ambas cosas sin renunciar a ninguna. Mantienes tu app
Feathers existente — sus hooks, sus estrategias de autenticación, sus servicios — y MCP obtiene
el acceso al socket crudo que su transporte realmente necesita.

Esa conciliación aparece en varios sitios:

### El transporte va montado sobre un servicio Feathers, no rodeándolo

MCP se registra como un servicio custom normal (`mcp-server`), así que pasa por el mismo hook
`authenticate()`, los mismos `params`, el mismo ciclo de vida que cualquier otra cosa en tu app.
El `params.user` de un handler de tool es el mismo objeto que recibiría una llamada REST o
Socket.io.

### Un GET sin id tiene que mapear a `find`

MCP hace POST de cada mensaje JSON-RPC, GET al endpoint desnudo para abrir el stream SSE
independiente, y DELETE para terminar la sesión. En Feathers, un GET sin id mapea a `find`, no a
`get`. Registrar solo `create`/`get` — la primera intuición obvia — deja el stream SSE
devolviendo 405.

### Hay que decirle al framework que se aparte, con cuidado

Una vez el transporte ha escrito en el socket, Koa o Express no deben volver a escribir en él.
Pero decirles que se aparten *antes* de que el transporte corra rompe el camino de error: un
fallo de autenticación ocurre antes de que el transporte vea la petición, así que silenciar la
maquinaria de respuesta del framework de antemano convierte un 401 en una conexión colgada. Mira
[Arquitectura](/es/docs/architecture/) para ver exactamente dónde se traza esa línea en Koa y en
Express.

### Una sesión, un servidor, sin excepciones

`Protocol.connect()` del SDK de MCP mantiene un único slot de transporte por `McpServer` y lo
sobrescribe en cada conexión. Si compartes un servidor entre sesiones, cada respuesta — y cada
`extra.sessionId` — se enruta hacia quien conectó *último*. Con dos llamadas concurrentes, eso
significa que la tool call del llamante A se ejecuta como el usuario autenticado del llamante B.
`feathers-mcp` da a cada sesión su propio `McpServer` y lo ata al principal que la abrió, así que
un usuario válido pero distinto que presente el mismo id de sesión es rechazado directamente.

:::tip[La misma app Feathers, no una segunda]
No hay un proceso MCP separado que desplegar, monitorizar o mantener sincronizado con las
reglas de autenticación y autorización de tu app. Es un servicio más en la app que ya tienes
corriendo.
:::
