---
title: Migrar desde 1.x
description: 2.0.0 es una versión de corrección y seguridad con cambios incompatibles.
---

2.0.0 es una versión de corrección y seguridad — varios de los arreglos cambian el
comportamiento, de ahí el major. Las versiones publicadas saltaron de 1.0.7 (la última release
1.x en npm) directamente a 2.0.0.

Los arreglos principales:

- **Las sesiones ya no comparten un único `McpServer`.** Bajo 1.x, dos clientes concurrentes
  podían acabar con la tool call de uno ejecutándose como el usuario autenticado del otro. Ver
  [Sesiones](/es/docs/sessions/).
- **`BaseTool.resourceFromUploadId` era un IDOR** — llamaba al servicio de uploads sin
  `params`, así que se saltaba cualquier hook de autorización basado en params. Ahora exige
  `params` y es un cambio de firma incompatible:
  `resourceFromUploadId(uploadId, uri, params, appendOriginalName?)`.
- **El stream SSE independiente ahora funciona** — un GET sin id mapea al `find` de Feathers,
  no a `get`; registrar solo `create`/`get` (la configuración de 1.x) lo dejaba devolviendo 405.
- **Express ahora está cubierto por la suite de integración** junto a Koa; un desajuste de
  claves en params entre el middleware del transporte y el servicio lo rompía en silencio antes.
- **Los bloques de contenido ahora coinciden exactamente con el spec de MCP** — `image` es
  plano (`{type, data, mimeType}`) con base64 crudo, `resource` lleva el binario en `blob`, no
  en `data`.
- Los esquemas TypeBox de tipo literal/enum ahora se validan de verdad y llegan correctamente
  al modelo; antes degradaban en silencio a un `z.string()` sin restricciones.

Los detalles completos, incluyendo cada arreglo y cada cambio incompatible, están en el
[CHANGELOG](https://github.com/nesgarbo/feathers-mcp/blob/main/CHANGELOG.md).
