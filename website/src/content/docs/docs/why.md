---
title: Why
description: MCP's transport writes to the raw socket — why that has to be bolted onto Feathers rather than dropped in as a route.
---

MCP's Streamable HTTP transport doesn't behave like a normal HTTP handler: it writes directly
to the raw Node socket itself, and expects to own that socket for the life of a session. Most
web frameworks — Feathers included — assume the opposite: the framework owns the response, and
your code returns a value that the framework serializes.

`feathers-mcp` exists to reconcile the two without giving up either side. You keep your
existing Feathers app — its hooks, its authentication strategies, its services — and MCP gets
the raw socket access its transport actually needs.

That reconciliation shows up in a few places:

### The transport is bolted onto a Feathers service, not routed around it

MCP is registered as a regular custom service (`mcp-server`), so it goes through the same
`authenticate()` hook, the same `params`, the same lifecycle as anything else in your app. A
tool handler's `params.user` is the same object a REST or Socket.io call would get.

### An id-less GET has to map to `find`

MCP POSTs every JSON-RPC message, GETs the bare endpoint to open the standalone SSE stream, and
DELETEs it to end the session. In Feathers, an id-less GET maps to `find`, not `get`.
Registering only `create`/`get` — the obvious first guess — leaves the SSE stream returning 405.

### The framework has to be told to back off, carefully

Once the transport has written to the socket, Koa or Express must not write to it again. But
telling them to back off *before* the transport runs breaks the failure path: an auth error
happens before the transport ever sees the request, so gagging the framework's response machinery
up front turns a 401 into a hung connection instead. See [Architecture](/docs/architecture/) for
exactly where that line gets drawn for Koa and for Express.

### One session, one server, no exceptions

The MCP SDK's `Protocol.connect()` keeps a single transport slot per `McpServer` and overwrites
it on every connect. Share one server across sessions and every response — and every
`extra.sessionId` — routes to whichever session connected last. With two concurrent callers,
that's caller A's tool call executing as caller B's authenticated user. `feathers-mcp` gives
every session its own `McpServer` and binds it to the principal that opened it, so a
valid-but-different user presenting the same session id is rejected outright.

:::tip[Same Feathers app, not a second one]
There's no separate MCP process to deploy, monitor, or keep in sync with your app's
authentication and authorization rules. It's one more service on the app you already run.
:::
