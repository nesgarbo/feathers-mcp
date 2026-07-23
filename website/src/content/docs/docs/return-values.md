---
title: Return values
description: A tool returns text, json, image and/or resource — binary payloads are raw base64.
---

A tool returns any combination of `text`, `json`, `image` and `resource`. Binary payloads are
**raw base64** — no `data:` URI prefix:

```ts
return { image: { type: "image", data: base64, mimeType: "image/png" } };
return { json: { type: "json", result: { rows } } };
```

`ToolResponse` shapes are mapped onto MCP content blocks. Two details matter if you're producing
binary content by hand rather than through a helper:

- MCP's `ImageContent` is **flat** — `{type, data, mimeType}`, raw base64, no `data:` URI.
- `EmbeddedResource` carries binary under **`blob`**, not `data`.

Getting either of these wrong produces content no MCP client can read, and nothing type-checks
it for you — the shape is validated against the MCP SDK's own schemas in this library's test
suite, not by the TypeScript compiler.
