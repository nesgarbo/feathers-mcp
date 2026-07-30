---
title: Statelessness
description: There are no sessions. Every request is authenticated and served on its own.
---

**There are no sessions.** Since 3.0.0, `feathers-mcp` serves MCP statelessly: one
`createMcpHandler` builds a fresh `McpServer` per HTTP request, whose tool callbacks close over
*that request's* Feathers params.

This is what MCP `2026-07-28` was designed around, and it deletes an entire class of problem
rather than managing it.

## What went away, and why it no longer matters

| 2.x | 3.0.0 |
| --- | --- |
| A session map in process memory | Nothing is held between requests |
| Idle TTL (`sessionTtlMs`) sweeping stale sessions | Nothing to expire |
| Session cap (`maxSessions`) bounding allocation | Nothing to cap |
| `ownerId` check rejecting a session id belonging to another user | No session id to present |
| A per-request params map, swept in a `finally` so a rejected call couldn't pin the caller's API key | Params are a closure over one request, collected with it |
| Sticky sessions required to run more than one instance | Any instance can serve any request |

Each of those existed only to make *sessionful* serving safe. The per-request shape gives the same
guarantees for free — a handler cannot reach another caller's context because it never had a
reference to one.

## Identity still rides on every call

Nothing about authentication changed. `allowMcpApiKey()` plus `authenticate()` still run as
Feathers hooks on every MCP request, so a request either carries a valid key or never reaches the
service. Your tool handler still gets a real `params.user`.

The difference is that this is now the *only* thing establishing identity. Under 2.x a request
could present a session id and inherit the identity behind it; now every request proves who it is.

## The two verbs that changed

GET (the 2025-era standalone SSE stream) and DELETE (2025-era session termination) are session
operations. Stateless serving answers both with **405**.

Nothing in this library used the standalone stream: tool notifications go out on the stream of the
call that produced them, tagged with its request id. If you were relying on the GET stream
directly, the modern replacement is `subscriptions/listen`.

## Options that are now no-ops

`sessionTtlMs` and `maxSessions` are accepted and ignored, with a warning under
`DEBUG=feathers-mcp`, so existing `feathersMcp()` calls don't break. Remove them.

See [Architecture](/docs/architecture/) for how a request reaches a tool handler, and
[Upgrading](/docs/upgrading/) for the full 3.0.0 delta.
