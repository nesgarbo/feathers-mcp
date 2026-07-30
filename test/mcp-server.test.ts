import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
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
      { onprogress: (p: any) => seen.push(p.progress) }
    )

    // The tool emits at 0 and 100. These used to be sent bare down the transport, which targets the
    // standalone SSE stream a POST-only client never opens, so nothing arrived.
    expect(seen).toEqual([0, 100])
  })
})

describe('concurrency', () => {
  it('runs concurrent calls without crossing their params', async () => {
    running = await createKoaApp()
    const { client } = await connect(running.url, 'key-alice')

    const results = await Promise.all([whoami(client, 150), whoami(client), whoami(client, 50)])

    expect(results).toEqual([
      'alice@example.com',
      'alice@example.com',
      'alice@example.com'
    ])
  })
})

/**
 * Serving is stateless: `createMcpHandler` builds one `McpServer` per request, whose tool callbacks
 * close over that request's Feathers params. What used to be enforced by session bookkeeping — an
 * idle sweep, a session cap, an owner check against session hijacking, a per-request params map that
 * had to be swept so a rejected call could not pin the caller's API key — is now a property of the
 * shape. These assert that the shape actually holds, and that the session verbs fail honestly.
 */
describe('stateless serving', () => {
  const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers
      },
      body: JSON.stringify(body)
    })

  it('serves a request that carries no session id at all', async () => {
    // Under the old sessionful wiring this was a 400 'Missing mcp-session-id header'. It is now the
    // ordinary case: nothing has to be opened first.
    running = await createKoaApp()

    const response = await post(
      running.url,
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { Authorization: 'Bearer key-alice' }
    )

    expect(response.status).toBe(200)
  })

  it('ignores a session id it never issued', async () => {
    // No session table to miss against, so an invented id is simply irrelevant rather than a 404.
    running = await createKoaApp()

    const response = await post(
      running.url,
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { Authorization: 'Bearer key-alice', 'mcp-session-id': '00000000-0000-4000-8000-000000000000' }
    )

    expect(response.status).toBe(200)
  })

  it('authenticates every request on its own, so no request rides another one in', async () => {
    // The session-hijacking case the old `ownerId` check existed for: there is nothing to hijack,
    // because a request with no valid key never reaches the service.
    running = await createKoaApp()
    const { client } = await connect(running.url, 'key-alice')
    expect(await whoami(client)).toBe('alice@example.com')

    const response = await post(running.url, {
      jsonrpc: '2.0',
      id: 99,
      method: 'tools/call',
      params: { name: 'whoami', arguments: {} }
    })

    expect(response.status).toBe(401)
  })

  it('does not leak params between two principals calling at once', async () => {
    running = await createKoaApp()
    const alice = await connect(running.url, 'key-alice')
    const bob = await connect(running.url, 'key-bob')

    const results = await Promise.all([
      whoami(alice.client, 120),
      whoami(bob.client),
      whoami(alice.client, 40),
      whoami(bob.client, 80)
    ])

    expect(results).toEqual([
      'alice@example.com',
      'bob@example.com',
      'alice@example.com',
      'bob@example.com'
    ])
  })

  it('answers the 2025-era session verbs with 405', async () => {
    // GET (standalone SSE stream) and DELETE (session termination) are session operations, and
    // stateless serving has no session. Refusing them is the SDK's own answer, in the shape a client
    // expects — not a Feathers 404 or a hang.
    running = await createKoaApp()

    const get = await fetch(running.url, {
      headers: { Accept: 'text/event-stream', Authorization: 'Bearer key-alice' }
    })
    const del = await fetch(running.url, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer key-alice' }
    })

    expect(get.status).toBe(405)
    expect(del.status).toBe(405)
  })

  it('survives a call the SDK rejects before the handler runs', async () => {
    // An unknown tool name and a schema-validation failure both skip the tool callback. There is no
    // per-session map left for them to pin, and the connection has to stay usable.
    running = await createKoaApp()
    const { client } = await connect(running.url, 'key-alice')

    for (let i = 0; i < 5; i++) {
      await client.callTool({ name: 'no_such_tool', arguments: {} }).catch(() => {})
      await client.callTool({ name: 'echo_json', arguments: { value: 12345 } }).catch(() => {})
    }

    expect(await whoami(client)).toBe('alice@example.com')
  })
})

describe('host apps with a non-standard user id field', () => {
  it('resolves the user through authentication.entityId', async () => {
    running = await createKoaApp({ uuidUsers: true })
    const { client } = await connect(running.url, 'key-alice')

    expect(await whoami(client)).toBe('alice@example.com')
  })
})
