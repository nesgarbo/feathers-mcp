---
title: Options
description: The options feathersMcp() accepts — serverInfo, sessionTtlMs, maxSessions.
---

```ts
import { feathersMcp } from "feathers-mcp";

app.configure(
  feathersMcp({
    tools: [RepeatTextTool],
    serverInfo: { name: "my-app", version: "2.0.0" }, // advertised on initialize
    sessionTtlMs: 30 * 60 * 1000, // idle session timeout; 0 disables
    maxSessions: 1000, // concurrent session ceiling; 0 disables
  })
);
```

| Option | Default | Effect |
| --- | --- | --- |
| `tools` | `[]` | Tool classes to instantiate and register on boot. |
| `serverInfo` | the library's own name/version | What the MCP server advertises to clients on `initialize`. |
| `sessionTtlMs` | 30 minutes | Idle timeout before a session is dropped. `0` disables expiry entirely. |
| `maxSessions` | 1000 | Ceiling on concurrent sessions. `0` disables the cap. |
| `authStrategy` | `'mcpApiKey'` | Registered Feathers authentication strategy run for every MCP call. Point this at a strategy your app already has instead of registering `McpApiKeyStrategy`. |
| `authField` | `'apiKey'` | Property the extracted header value is placed under on the authentication request object. Only matters when `authStrategy` points at a pre-existing strategy expecting a different field. |

Both `sessionTtlMs` and `maxSessions` are enforced lazily — swept on request, not on a timer —
since sessions live in process memory and a library shouldn't hold an interval open in a host's
event loop. See [Sessions](/docs/sessions/) for why the TTL is the *only* thing that frees a
session on an ordinary client disconnect.
