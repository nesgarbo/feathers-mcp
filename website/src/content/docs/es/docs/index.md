---
title: Documentación
description: Documentación de feathers-mcp — conecta un servidor Model Context Protocol a una app FeathersJS v5 existente como un servicio más.
tableOfContents: false
---

`feathers-mcp` conecta un servidor [Model Context Protocol](https://modelcontextprotocol.io) a
una app FeathersJS v5 existente como un servicio más. No hay proceso separado, ni una pila de
autenticación paralela, ni un almacén de sesiones aparte — cada llamada a una tool de MCP es una
llamada Feathers real y autenticada, con un `params.user` real que tus hooks ya entienden.

## Por dónde empezar

- **[Por qué](/es/docs/why/)** — el problema que resuelve `feathers-mcp`, y por qué el transporte de MCP tiene que ir montado sobre Feathers en lugar de añadirse como una ruta normal.
- **[Arquitectura](/es/docs/architecture/)** — el flujo de la petición, el mapeo de verbos, y el modelo de servidor por sesión.
- **[Guía rápida](/es/docs/quickstart/)** — integración copiar-pegar; Koa y Express se registran igual.
- **Guías** — [escribir tools](/es/docs/tools/), [sesiones](/es/docs/sessions/), [notificaciones](/es/docs/notifications/), [llamar a otros servicios](/es/docs/calling-services/), y [valores de retorno](/es/docs/return-values/).
- **[Opciones](/es/docs/options/)**, **[depuración](/es/docs/debugging/)**, y **[migrar desde 1.x](/es/docs/upgrading/)**.

El código fuente y los issues están en [GitHub](https://github.com/nesgarbo/feathers-mcp).
