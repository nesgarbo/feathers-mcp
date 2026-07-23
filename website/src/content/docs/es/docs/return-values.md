---
title: Valores de retorno
description: Una tool devuelve text, json, image y/o resource — los payloads binarios son base64 crudo.
---

Una tool devuelve cualquier combinación de `text`, `json`, `image` y `resource`. Los payloads
binarios son **base64 crudo** — sin prefijo `data:` URI:

```ts
return { image: { type: "image", data: base64, mimeType: "image/png" } };
return { json: { type: "json", result: { rows } } };
```

Las formas de `ToolResponse` se mapean a bloques de contenido de MCP. Dos detalles importan si
estás produciendo contenido binario a mano en lugar de a través de un helper:

- `ImageContent` de MCP es **plano** — `{type, data, mimeType}`, base64 crudo, sin `data:` URI.
- `EmbeddedResource` lleva el binario bajo **`blob`**, no `data`.

Equivocarte en cualquiera de los dos produce contenido que ningún cliente MCP puede leer, y nada
lo comprueba de tipos por ti — la forma se valida contra los propios esquemas del SDK de MCP en
la suite de tests de esta biblioteca, no por el compilador de TypeScript.
