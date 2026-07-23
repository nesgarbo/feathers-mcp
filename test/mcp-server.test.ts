import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { createExpressApp, createKoaApp, type TestApp } from './test-app.js'

let running: TestApp | undefined

afterEach(async () => {
  await running?.close()
  running = undefined
})

const connect = async (url: string, apiKey: string) => {
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${apiKey}` } }
  })
  const client = new Client({ name: 'test-client', version: '1.0.0' })
  await client.connect(transport)
  return { client, transport }
}

const textOf = (result: any): string => result.content.find((c: any) => c.type === 'text')?.text

const whoami = async (client: Client, delayMs?: number) =>
  textOf(await client.callTool({ name: 'whoami', arguments: delayMs ? { delayMs } : {} }))

describe.each([
  ['koa', createKoaApp],
  ['express', createExpressApp]
])('mcp-server over %s', (_name, createApp) => {
  it('runs a tool as the user behind the API key', async () => {
    running = await createApp()
    const { client } = await connect(running.url, 'key-alice')

    expect(await whoami(client)).toBe('alice@example.com')
  })

  it('only lists tools exposed to MCP', async () => {
    running = await createApp()
    const { client } = await connect(running.url, 'key-alice')

    // hidden_tool has `expose: { mcp: false }` and must not appear.
    const names = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['boom', 'echo_json', 'whoami'])
  })

  it('keeps concurrent sessions on their own identities', async () => {
    // The regression that matters: a single shared McpServer let the most recently connected
    // transport define `extra.sessionId` for every session, so Alice's tool call ran as Bob.
    running = await createApp()
    const alice = await connect(running.url, 'key-alice')
    const bob = await connect(running.url, 'key-bob')

    const [a, b] = await Promise.all([whoami(alice.client), whoami(bob.client)])

    expect(a).toBe('alice@example.com')
    expect(b).toBe('bob@example.com')
  })

  it('keeps identities apart when a new session connects mid-call', async () => {
    running = await createApp()
    const alice = await connect(running.url, 'key-alice')

    // Alice's call is in flight; Bob connecting during it used to overwrite the server's transport.
    const pending = whoami(alice.client, 250)
    await new Promise((resolve) => setTimeout(resolve, 50))
    const bob = await connect(running.url, 'key-bob')
    const bobResult = await whoami(bob.client)

    expect(await pending).toBe('alice@example.com')
    expect(bobResult).toBe('bob@example.com')
  })

  it('reports tool errors as isError instead of killing the session', async () => {
    running = await createApp()
    const { client } = await connect(running.url, 'key-alice')

    const result: any = await client.callTool({ name: 'boom', arguments: {} })
    expect(result.isError).toBe(true)
    expect(textOf(result)).toContain('tool exploded')

    // Session survives.
    expect(await whoami(client)).toBe('alice@example.com')
  })

  it('rejects an unknown API key', async () => {
    running = await createApp()
    await expect(connect(running.url, 'key-does-not-exist')).rejects.toThrow()
  })

  it('rejects a revoked API key', async () => {
    running = await createApp()
    await expect(connect(running.url, 'key-revoked')).rejects.toThrow()
  })

  it('rejects a request with no API key', async () => {
    running = await createApp()
    await expect(connect(running.url, '')).rejects.toThrow()
  })

  it('authenticates through a pre-existing host strategy, no mcp-api-keys service required', async () => {
    // `authStrategy`/`authField` let a host app that already has its own API-key strategy point
    // feathers-mcp at it, rather than being forced to register McpApiKeyStrategy as 'mcpApiKey'.
    running = await createApp({ customAuthStrategy: true })
    const { client } = await connect(running.url, 'key-bob')

    expect(await whoami(client)).toBe('bob@example.com')
  })

  it('rejects an unknown token through the pre-existing host strategy', async () => {
    running = await createApp({ customAuthStrategy: true })
    await expect(connect(running.url, 'key-does-not-exist')).rejects.toThrow()
  })
})

describe('tool results', () => {
  it('returns json results as text plus structuredContent', async () => {
    running = await createKoaApp()
    const { client } = await connect(running.url, 'key-alice')

    const result: any = await client.callTool({ name: 'echo_json', arguments: { value: 'hi' } })

    expect(textOf(result)).toBe('{"echoed":"hi"}')
    expect(result.structuredContent).toEqual({ echoed: 'hi' })
  })

  it('delivers progress notifications for the call that produced them', async () => {
    running = await createKoaApp()
    const { client } = await connect(running.url, 'key-alice')

    const seen: number[] = []
    await client.callTool(
      { name: 'whoami', arguments: {} },
      undefined,
      { onprogress: (p: any) => seen.push(p.progress) }
    )

    // The tool emits at 0 and 100. These used to be sent bare down the transport, which targets the
    // standalone SSE stream a POST-only client never opens, so nothing arrived.
    expect(seen).toEqual([0, 100])
  })
})

describe('session lifecycle', () => {
  it('runs concurrent calls on one session without crossing their params', async () => {
    running = await createKoaApp()
    const { client } = await connect(running.url, 'key-alice')

    const results = await Promise.all([whoami(client, 150), whoami(client), whoami(client, 50)])

    expect(results).toEqual([
      'alice@example.com',
      'alice@example.com',
      'alice@example.com'
    ])
  })

  it('terminates a session on DELETE', async () => {
    running = await createKoaApp()
    const { client, transport } = await connect(running.url, 'key-alice')
    const sessionId = transport.sessionId!

    await transport.terminateSession()

    const response = await fetch(running.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer key-alice',
        'mcp-session-id': sessionId
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })

    expect(response.status).toBe(404)
    await client.close().catch(() => {})
  })

  it('expires an idle session', async () => {
    running = await createKoaApp({ sessionTtlMs: 60 })
    const alice = await connect(running.url, 'key-alice')
    expect(await whoami(alice.client)).toBe('alice@example.com')

    await new Promise((resolve) => setTimeout(resolve, 120))

    // The sweep is lazy, so another request has to come in to trigger it. Open a second session,
    // then confirm the stale one is gone.
    await connect(running.url, 'key-bob')

    const response = await fetch(running.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer key-alice',
        'mcp-session-id': alice.transport.sessionId!
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })

    expect(response.status).toBe(404)
  })
})

describe('resource bookkeeping', () => {
  const sessionsOf = (app: TestApp) => (app.app.service('mcp-server') as any).sessions

  it('does not retain per-call params after a call the SDK rejects', async () => {
    running = await createKoaApp()
    const { client } = await connect(running.url, 'key-alice')

    // The SDK skips the tool callback entirely for an unknown tool name or a schema-validation
    // failure, so the cleanup that lived only inside that callback never ran. Every leaked entry
    // pinned the caller's params — user object *and* the raw API key from the Authorization header.
    for (let i = 0; i < 5; i++) {
      await client.callTool({ name: 'no_such_tool', arguments: {} }).catch(() => {})
      await client.callTool({ name: 'echo_json', arguments: { value: 12345 } }).catch(() => {})
    }
    await whoami(client)

    const [session] = [...sessionsOf(running).values()] as any[]
    expect(session.paramsByRequest.size).toBe(0)
  })

  it('refuses to open sessions past the cap', async () => {
    running = await createKoaApp({ maxSessions: 2 })
    await connect(running.url, 'key-alice')
    await connect(running.url, 'key-alice')

    // Without a cap, one valid key looping `initialize` allocates McpServer instances forever.
    await expect(connect(running.url, 'key-alice')).rejects.toThrow()
    expect(sessionsOf(running).size).toBe(2)
  })
})

describe('host apps with a non-standard user id field', () => {
  it('binds a session using authentication.entityId', async () => {
    // A host whose users are keyed by `uuid` rather than `id` would otherwise never get a
    // principal, and every `initialize` would 401.
    running = await createKoaApp({ uuidUsers: true })
    const { client } = await connect(running.url, 'key-alice')

    expect(await whoami(client)).toBe('alice@example.com')
  })
})

describe('session ownership', () => {
  it("refuses to reuse another principal's session id", async () => {
    running = await createKoaApp()
    const alice = await connect(running.url, 'key-alice')
    const sessionId = alice.transport.sessionId
    expect(sessionId).toBeTruthy()

    // Bob is a fully valid principal, but this session is not his.
    const response = await fetch(running.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer key-bob',
        'mcp-session-id': sessionId!
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 99,
        method: 'tools/call',
        params: { name: 'whoami', arguments: {} }
      })
    })

    expect(response.status).toBe(403)
    const body = await response.json()
    expect(body.error.message).toMatch(/another principal/i)
  })

  it('rejects an unknown session id', async () => {
    running = await createKoaApp()
    // Open one valid session so the service is warm.
    await connect(running.url, 'key-alice')

    const response = await fetch(running.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer key-alice',
        'mcp-session-id': '00000000-0000-4000-8000-000000000000'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })

    expect(response.status).toBe(404)
  })

  it('rejects a non-initialize request that carries no session id', async () => {
    running = await createKoaApp()

    const response = await fetch(running.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: 'Bearer key-alice'
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
    })

    expect(response.status).toBe(400)
  })
})
