---
title: Por qué
description: El handler de MCP escribe directo al socket — por qué eso obliga a montarlo sobre Feathers en vez de añadirlo como una ruta.
---

El handler HTTP de MCP no se comporta como un handler HTTP normal: escribe directamente sobre el
socket crudo de Node, y espera ser dueño de ese socket mientras dura el intercambio. La mayoría de
frameworks web — Feathers incluido — asumen lo contrario: el framework es dueño de la respuesta, y
tu código devuelve un valor que el framework serializa.

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

Una vez el handler de MCP ha escrito en el socket, Koa o Express no deben volver a escribir en él.
Pero decirles que se aparten *antes* de que el handler corra rompe el camino de error: un fallo de
autenticación ocurre antes de que el handler vea la petición, así que silenciar la maquinaria de
respuesta del framework de antemano convierte un 401 en una conexión colgada. Mira
[Arquitectura](/es/docs/architecture/) para ver exactamente dónde se traza esa línea en Koa y en
Express.

### Un servidor por petición, nunca compartido

Se construye un `McpServer` nuevo para cada petición, y sus callbacks de tools capturan los params
de Feathers de esa petición. Dos llamantes concurrentes no pueden ver el contexto del otro porque
ninguno llega a tener una referencia al ajeno — sin tabla de sesiones, sin identidad que heredar,
sin nada que secuestrar. Mira [Sin estado](/es/docs/sessions/).

:::tip[La misma app Feathers, no una segunda]
No hay un proceso MCP separado que desplegar, monitorizar o mantener sincronizado con las
reglas de autenticación y autorización de tu app. Es un servicio más en la app que ya tienes
corriendo.
:::
