---
title: Debugging
description: Trace sessions and tool calls with DEBUG=feathers-mcp.
---

Session and tool tracing is off by default — a library has no business writing to a host app's
stdout unless asked to. Turn it on with the standard [`debug`](https://www.npmjs.com/package/debug)
namespace:

```bash
DEBUG=feathers-mcp node app.js
```

```bash
DEBUG=feathers-mcp bun run test
```

This traces session creation/teardown and tool dispatch — useful for anything session- or
transport-related, since that's exactly where raw-socket handling and per-session isolation can
go wrong in ways that don't show up as a thrown error.
