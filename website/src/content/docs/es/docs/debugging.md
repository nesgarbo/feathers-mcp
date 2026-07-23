---
title: Depuración
description: Traza sesiones y llamadas a tools con DEBUG=feathers-mcp.
---

El trazado de sesiones y tools está desactivado por defecto — una biblioteca no tiene por qué
escribir en el stdout de la app anfitriona a menos que se le pida. Actívalo con el namespace
estándar de [`debug`](https://www.npmjs.com/package/debug):

```bash
DEBUG=feathers-mcp node app.js
```

```bash
DEBUG=feathers-mcp bun run test
```

Esto traza la creación/destrucción de sesiones y el despacho de tools — útil para cualquier cosa
relacionada con sesión o transporte, que es justo donde el manejo del socket crudo y el
aislamiento por sesión pueden fallar de formas que no se ven como un error lanzado.
