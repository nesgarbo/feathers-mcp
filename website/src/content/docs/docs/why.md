---
title: Why
description: MCP's transport writes to the raw socket — why that has to be bolted onto Feathers rather than dropped in as a route.
---

MCP's HTTP handler doesn't behave like a normal HTTP handler: it writes directly to the raw Node
socket itself, and expects to own that socket for the duration of the exchange. Most web
frameworks — Feathers included — assume the opposite: the framework owns the response, and your
code returns a value that the framework serializes.

`feathers-mcp` exists to reconcile the two without giving up either side. You keep your
existing Feathers app — its hooks, its authentication strategies, its services — and MCP gets
the raw socket access its transport actually needs.

That reconciliation shows up in a few places:

### The handler is bolted onto a Feathers service, not routed around it

MCP is registered as a regular custom service (`mcp-server`), so it goes through the same
`authenticate()` hook, the same `params`, the same lifecycle as anything else in your app. A
tool handler's `params.user` is the same object a REST or Socket.io call would get.

### An id-less GET has to map to `find`

MCP POSTs every JSON-RPC message in both protocol eras; the 2025 era also GETs the bare endpoint
for a standalone SSE stream and DELETEs it to end a session. In Feathers, an id-less GET maps to
`find`, not `get` — so all four verbs have to be registered for those refusals to come back in the
shape a client understands rather than as a Feathers 404.

### The framework has to be told to back off, carefully

Once the MCP handler has written to the socket, Koa or Express must not write to it again. But
telling them to back off *before* the handler runs breaks the failure path: an auth error happens
before the handler ever sees the request, so gagging the framework's response machinery up front
turns a 401 into a hung connection instead. See [Architecture](/docs/architecture/) for exactly
where that line gets drawn for Koa and for Express.

### One server per request, never shared

A fresh `McpServer` is built for each request, and its tool callbacks close over that request's
Feathers params. Two concurrent callers cannot see each other's context because neither ever holds
a reference to the other's — no session table, no identity to inherit, nothing to hijack. See
[Statelessness](/docs/sessions/).

:::tip[Same Feathers app, not a second one]
There's no separate MCP process to deploy, monitor, or keep in sync with your app's
authentication and authorization rules. It's one more service on the app you already run.
:::
