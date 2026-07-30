---
title: Options
description: The options feathersMcp() accepts — tools, serverInfo, authStrategy, authField.
---

```ts
import { feathersMcp } from "feathers-mcp";

app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
    serverInfo: { name: "my-app", version: "2.0.0" },
  })
);
```

| Option | Default | Effect |
| --- | --- | --- |
| `tools` | `[]` | Tool classes to instantiate and register on boot. |
| `serverInfo` | the library's own name/version | What the MCP server advertises to clients — on `initialize` in the 2025 era, on `server/discover` in the 2026 one. |
| `authStrategy` | `'mcpApiKey'` | Registered Feathers authentication strategy run for every MCP call. Point this at a strategy your app already has instead of registering `McpApiKeyStrategy`. |
| `authField` | `'apiKey'` | Property the extracted header value is placed under on the authentication request object. Only matters when `authStrategy` points at a pre-existing strategy expecting a different field. |

## Removed in 3.0.0

| Option | Status |
| --- | --- |
| `sessionTtlMs` | No-op. Accepted and ignored, with a warning under `DEBUG=feathers-mcp`. |
| `maxSessions` | No-op. Same. |

Serving is stateless — there are no sessions to expire or cap. They are still accepted so an
existing `feathersMcp()` call doesn't break on upgrade, but you should delete them. See
[Statelessness](/docs/sessions/).
