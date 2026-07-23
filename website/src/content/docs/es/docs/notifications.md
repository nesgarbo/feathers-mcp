---
title: Notificaciones
description: emit() envía notificaciones de progreso y log al cliente mientras una tool call está corriendo.
---

`emit` envía notificaciones al cliente mientras una tool call sigue corriendo, sobre el mismo
stream en el que va la llamada — no el stream SSE independiente, que un cliente solo-POST nunca
abre. Un número a secas es progreso; pasa un objeto para cualquier otra cosa:

```ts
emit("Halfway", 50); // notificación de progreso
emit("Halfway", { progress: 50, total: 200 }); // progreso sobre un total personalizado
emit("Fetching rows", { type: "log", level: "info" }); // notificación de log
```

:::note[El método MCP es `notifications/message`]
No `notifications/log` — ese método no existe en el spec. `emit` se encarga de esto por ti; solo
importa si estás depurando tráfico JSON-RPC crudo.
:::

Las notificaciones salen a través del `extra.sendNotification` del SDK de MCP, que las etiqueta
con el id de la petición de origen para que lleguen al mismo stream que la tool call que las
está produciendo.
