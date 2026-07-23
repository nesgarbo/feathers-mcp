---
title: Notifications
description: emit() sends progress and log notifications to the client while a tool call is running.
---

`emit` sends notifications to the client while a tool call is still running, over the same
stream the call itself is on — not the standalone SSE stream, which a POST-only client never
opens. A bare number is progress; pass an object for anything else:

```ts
emit("Halfway", 50); // progress notification
emit("Halfway", { progress: 50, total: 200 }); // progress out of a custom total
emit("Fetching rows", { type: "log", level: "info" }); // log notification
```

:::note[The MCP method is `notifications/message`]
Not `notifications/log` — that method doesn't exist in the spec. `emit` handles this for you;
it's only worth knowing if you're debugging raw JSON-RPC traffic.
:::

Notifications go out through the MCP SDK's `extra.sendNotification`, which tags them with the
originating request id so they reach the same stream as the tool call that's producing them.
