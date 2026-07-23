---
title: Upgrading from 1.x
description: 2.0.0 is a correctness and security release with breaking changes.
---

2.0.0 is a correctness and security release — several of the fixes change behaviour, hence the
major. Published versions jumped from 1.0.7 (the last 1.x release on npm) straight to 2.0.0.

The headline fixes:

- **Sessions no longer share a single `McpServer`.** Under 1.x, two concurrent clients could
  have one caller's tool call execute as another caller's authenticated user. See
  [Sessions](/docs/sessions/).
- **`BaseTool.resourceFromUploadId` was an IDOR** — it called the uploads service with no
  `params`, so every params-based authorization hook was skipped. It now requires `params` and
  is a breaking signature change: `resourceFromUploadId(uploadId, uri, params, appendOriginalName?)`.
- **The standalone SSE stream now actually works** — an id-less GET maps to Feathers' `find`,
  not `get`; only registering `create`/`get` (1.x's setup) left it 405ing.
- **Express is now covered by the integration suite** alongside Koa; a params key mismatch
  between the transport middleware and the service silently broke it before.
- **Content blocks now match the MCP spec exactly** — `image` is flat
  (`{type, data, mimeType}`) with raw base64, `resource` carries binary under `blob`, not
  `data`.
- Literal/enum TypeBox schemas are now actually validated and reach the model correctly;
  previously they silently degraded to an unconstrained `z.string()`.

Full details, including every fix and every breaking change, are in the
[CHANGELOG](https://github.com/nesgarbo/feathers-mcp/blob/main/CHANGELOG.md).
