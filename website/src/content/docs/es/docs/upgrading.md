---
title: Actualizar
description: 3.0.0 salta al SDK v2 de MCP y sirve la revisión de protocolo 2026-07-28.
---

## Actualizar a 3.0.0

3.0.0 abandona el retirado `@modelcontextprotocol/sdk` v1 monolítico y pasa a los paquetes v2, y
sirve la revisión de protocolo MCP **`2026-07-28`** de forma nativa junto al protocolo de la era
2025.

### Cambia tus peer dependencies

`@modelcontextprotocol/sdk` desaparece. Instala los dos paquetes que lo sustituyen:

```bash
npm remove @modelcontextprotocol/sdk
npm install @modelcontextprotocol/server @modelcontextprotocol/node
```

También hacen falta **Node.js 20+** y **zod 4.2+** (el mínimo que exige el propio v2).

### El servicio ya no tiene estado

No hay sesiones. Cada petición se autentica y se sirve por sí sola, con un `McpServer` nuevo cuyos
callbacks de tools capturan los params de Feathers de esa petición.

- `sessionTtlMs` y `maxSessions` **no hacen nada** — se aceptan y se ignoran para que tu llamada a
  `feathersMcp()` no se rompa, pero bórralas.
- El `GET` (stream SSE independiente) y el `DELETE` (terminación de sesión) de la era 2025 ahora
  responden **405**. Nada en esta biblioteca los usaba.
- Correr más de una instancia ya no necesita sticky sessions.

Todo el detalle en [Sin estado](/es/docs/sessions/).

### Qué no cambia

La autoría de tools, `BaseTool`, los esquemas TypeBox, `emit`, los valores de retorno, las
estrategias de autenticación y todas las opciones de `feathersMcp()` salvo las dos de arriba
siguen igual. Los clientes sobre el SDK v1 — que es lo que todavía embarca la mayoría de apps
anfitrionas — siguen funcionando sin modificaciones.

## Migrar de 1.x a 2.x

2.0.0 fue una versión de corrección y seguridad — varios de los arreglos cambian el
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
