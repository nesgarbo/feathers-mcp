---
title: Sessions
description: One McpServer per session, bound to the user that opened it, reaped by idle TTL.
---

**One `McpServer` per session, never shared.** The MCP SDK's `Protocol.connect()` keeps a
single `_transport` slot and overwrites it on every connect — its own docstring says it assumes
exclusive ownership. A server shared across sessions would route every response, and every
`extra.sessionId`, to whichever session connected *last*: with two concurrent callers, caller
A's tool call would execute as caller B's authenticated user.

Tool callbacks close over their own session object. There is deliberately no session-id lookup
inside a handler — the handler simply cannot reach another session's state, by construction, not
by convention.

## Ownership

Sessions are bound to the principal that opened them (`ownerId`, resolved through
`authentication.entityId` — not a hard-coded `id` field). A request presenting a valid session id
that belongs to a *different* authenticated user is rejected with 403, rather than silently
attaching to that session.

## Per-request params, not per-session params

Within one session, several tool calls can be in flight at once. A handler gets the params of
**its own** request via a map keyed on the request id — not a single mutable `session.params`
that the next concurrent call would clobber.

That map is cleaned up in a `finally`, not only from inside the tool callback: the MCP SDK skips
the callback entirely for an unknown tool name or a schema-validation failure. Without the
`finally`, every skipped call would pin the caller's params — the user object *and* the raw API
key from the auth header — in memory for the life of the session. A client that calls an unknown
tool name in a loop would otherwise grow the session's memory footprint without bound.

## Lifecycle

Sessions are reaped two ways, both enforced **lazily** — swept on request, never on a timer,
because a library has no business holding an interval open in a host app's event loop:

- **Idle TTL** (`sessionTtlMs`, default 30 minutes; `0` disables it).
- **Count cap** (`maxSessions`, default 1000; `0` disables it).

The MCP client does **not** send DELETE on a plain `close()` — only on `terminateSession()` — so
`transport.onclose` never fires on an ordinary disconnect. The idle TTL is the only thing that
frees those sessions; without it, they'd accumulate for the life of the process.

Sessions live in process memory. Running more than one instance of your app requires sticky
sessions in front of it.

See [Options](/docs/options/) for `sessionTtlMs`/`maxSessions`, and
[Architecture](/docs/architecture/) for how the raw socket handoff and the session model fit
together.
