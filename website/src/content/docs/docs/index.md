---
title: Documentation
description: feathers-mcp docs — plug a Model Context Protocol server into an existing FeathersJS v5 app as a regular service.
tableOfContents: false
---

`feathers-mcp` plugs a [Model Context Protocol](https://modelcontextprotocol.io) server into
an existing FeathersJS v5 app as a regular service. There is no separate process, no parallel
auth stack, no side-channel session store — every MCP tool call is a real, authenticated
Feathers call, with a real `params.user` your existing hooks already understand.

## Where to start

- **[Why](/docs/why/)** — the problem `feathers-mcp` solves, and why MCP's transport has to be bolted onto Feathers rather than dropped in as a normal route.
- **[Architecture](/docs/architecture/)** — request flow, verb mapping, and the per-session server model.
- **[Quickstart](/docs/quickstart/)** — copy-paste integration; Koa and Express register identically.
- **Guides** — [writing tools](/docs/tools/), [sessions](/docs/sessions/), [notifications](/docs/notifications/), [calling other services](/docs/calling-services/), and [return values](/docs/return-values/).
- **[Options](/docs/options/)**, **[debugging](/docs/debugging/)**, and **[upgrading from 1.x](/docs/upgrading/)**.

Source and issues live on [GitHub](https://github.com/nesgarbo/feathers-mcp).
