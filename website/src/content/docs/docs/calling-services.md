---
title: Calling other services
description: Always forward a tool handler's params — dropping them turns any id argument into an IDOR.
---

**Always forward the handler's `params`** when calling another service from a tool. A service
call with no params is an *internal* call — `params.provider` is undefined — and every
authorization hook written the usual way (`if (context.params.provider)`) is skipped,
`authenticate()` included.

```ts
async handler(input: Static<typeof MyTool.inputSchema>, params: McpParams, emit: EmitFunction) {
  // Forward params. Do not call app.service('uploads').get(input.uploadId) bare.
  const record = await this.app.service("uploads").get(input.uploadId, params);
  // ...
}
```

Since a tool's arguments come from the model, dropping params turns any id argument the model
supplies into an IDOR: whatever authorization your `uploads` hooks enforce for a real request
never runs, and the tool will happily fetch a record belonging to a different user.

:::caution[This shipped as a real bug once]
`BaseTool.resourceFromUploadId` originally called `uploads.get(id)` with no params — exactly
this bug. It now requires `params` as a parameter and refuses to run without them. See the
[2.0.0 changelog entry](https://github.com/nesgarbo/feathers-mcp/blob/main/CHANGELOG.md) for the
full writeup.
:::
