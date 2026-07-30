---
title: Depuración
description: Traza el manejo de peticiones MCP y las llamadas a tools con DEBUG=feathers-mcp.
---

El trazado de peticiones y tools está desactivado por defecto — una biblioteca no tiene por qué
escribir en el stdout de la app anfitriona a menos que se le pida. Actívalo con el namespace
estándar de [`debug`](https://www.npmjs.com/package/debug):

```bash
DEBUG=feathers-mcp node app.js
```

```bash
DEBUG=feathers-mcp bun run test
```

Esto traza las peticiones entrantes, el despacho de tools y el cierre del handler — útil para
cualquier cosa relacionada con el transporte o el protocolo, que es justo donde el manejo del
socket crudo y el aislamiento por petición pueden fallar de formas que no se ven como un error
lanzado.
