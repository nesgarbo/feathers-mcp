import { Client as ModernClient, StreamableHTTPClientTransport as ModernTransport } from '@modelcontextprotocol/client'
import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY
} from '@modelcontextprotocol/server'
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { SUPPORTED_PROTOCOL_VERSIONS as LEGACY_VERSIONS } from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it } from 'vitest'
import { createExpressApp, createKoaApp, type TestApp } from './test-app.js'

/**
 * Protocol-revision coverage across both eras.
 *
 * `2026-07-28` ("modern") drops the `initialize` handshake for a stateless `server/discover` and a
 * per-request `_meta` envelope; everything up to `2025-11-25` ("legacy") is handshake-and-session.
 * `createMcpHandler` classifies each request and serves both from one endpoint, so what has to hold
 * is that neither era regresses: a modern client gets modern serving without falling back, and a
 * client still on the v1 SDK — which is what host apps in the field actually ship — keeps working
 * unchanged even though there are no sessions behind the endpoint any more.
 *
 * The legacy half is driven by the real v1 SDK client (a devDependency for exactly this), not by the
 * v2 client in `legacy` mode, so it is the wire a deployed 2025-era host actually produces.
 */

const MODERN_VERSION = '2026-07-28'

let running: TestApp | undefined

afterEach(async () => {
  await running?.close()
  running = undefined
})

const modernTransport = (url: string) =>
  new ModernTransport(new URL(url), {
    requestInit: { headers: { Authorization: 'Bearer key-alice' } }
  })

const rpc = async (
  url: string,
  body: unknown,
  headers: Record<string, string> = {}
): Promise<{ status: number; body: any }> => {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      Authorization: 'Bearer key-alice',
      ...headers
    },
    body: JSON.stringify(body)
  })

  const text = await response.text()
  // A streamed answer comes back as SSE; a single-shot one as plain JSON.
  const json = text.startsWith('event:')
    ? JSON.parse(text.split('\n').find((line) => line.startsWith('data: '))!.slice(6))
    : text
      ? JSON.parse(text)
      : undefined

  return { status: response.status, body: json }
}

/** A hand-built 2026-07-28 request: the `_meta` envelope plus the two headers the era requires. */
const modernRpc = (url: string, method: string, params: Record<string, unknown> = {}) =>
  rpc(
    url,
    {
      jsonrpc: '2.0',
      id: 1,
      method,
      params: {
        ...params,
        _meta: {
          [PROTOCOL_VERSION_META_KEY]: MODERN_VERSION,
          [CLIENT_INFO_META_KEY]: { name: 'test-client', version: '1.0.0' },
          [CLIENT_CAPABILITIES_META_KEY]: {}
        }
      }
    },
    { 'MCP-Protocol-Version': MODERN_VERSION, 'Mcp-Method': method }
  )

describe.each([
  ['koa', createKoaApp],
  ['express', createExpressApp]
])('a 2026-07-28 client over %s', (_name, createApp) => {
  it('negotiates the modern era and runs tools', async () => {
    // `mode: 'auto'` probes with `server/discover` first. Before the v2 migration this server had no
    // such method and the client fell back to `initialize`; now the probe is answered natively.
    running = await createApp()

    const client = new ModernClient(
      { name: 'modern-client', version: '1.0.0' },
      { versionNegotiation: { mode: 'auto' } }
    )
    await client.connect(modernTransport(running.url))

    const names = (await client.listTools()).tools.map((t) => t.name).sort()
    expect(names).toEqual(['boom', 'echo_json', 'whoami'])

    const result: any = await client.callTool({ name: 'whoami', arguments: {} })
    expect(result.content[0].text).toBe('alice@example.com')

    await client.close()
  })

  it('connects when the client pins 2026-07-28 with no fallback allowed', async () => {
    // Pinned mode fails loudly unless `server/discover` actually offers the pinned revision, so this
    // is the assertion that the endpoint is genuinely modern rather than merely tolerant.
    running = await createApp()

    const client = new ModernClient(
      { name: 'pinned-client', version: '1.0.0' },
      { versionNegotiation: { mode: { pin: MODERN_VERSION } } }
    )
    await client.connect(modernTransport(running.url))

    const result: any = await client.callTool({ name: 'whoami', arguments: {} })
    expect(result.content[0].text).toBe('alice@example.com')

    await client.close()
  })

  it('runs a tool as the right user when two principals are pinned modern at once', async () => {
    // The modern era has no session to key identity off, so identity rides entirely on the Feathers
    // params the per-request factory closes over. This is that guarantee, on the modern path.
    running = await createApp()

    const clientFor = async (apiKey: string) => {
      const client = new ModernClient(
        { name: `modern-${apiKey}`, version: '1.0.0' },
        { versionNegotiation: { mode: { pin: MODERN_VERSION } } }
      )
      await client.connect(
        new ModernTransport(new URL(running!.url), {
          requestInit: { headers: { Authorization: `Bearer ${apiKey}` } }
        })
      )
      return client
    }

    const [alice, bob] = await Promise.all([clientFor('key-alice'), clientFor('key-bob')])
    const [a, b]: any[] = await Promise.all([
      alice.callTool({ name: 'whoami', arguments: { delayMs: 120 } }),
      bob.callTool({ name: 'whoami', arguments: {} })
    ])

    expect(a.content[0].text).toBe('alice@example.com')
    expect(b.content[0].text).toBe('bob@example.com')

    await Promise.all([alice.close(), bob.close()])
  })
})

describe.each([
  ['koa', createKoaApp],
  ['express', createExpressApp]
])('a v1-SDK (2025-era) client over %s', (_name, createApp) => {
  it('still connects and runs tools against a stateless endpoint', async () => {
    // The compatibility that matters most in practice: every host app currently in the field ships
    // this client. Stateless legacy serving must not have broken it.
    running = await createApp()

    const client = new LegacyClient({ name: 'legacy-client', version: '1.0.0' })
    await client.connect(
      new LegacyTransport(new URL(running.url), {
        requestInit: { headers: { Authorization: 'Bearer key-alice' } }
      })
    )

    const names = (await client.listTools()).tools.map((t: any) => t.name).sort()
    expect(names).toEqual(['boom', 'echo_json', 'whoami'])

    const result: any = await client.callTool({ name: 'whoami', arguments: {} })
    expect(result.content[0].text).toBe('alice@example.com')

    await client.close()
  })

  it('receives the progress notifications a tool emits', async () => {
    // `emit` goes out through `ctx.mcpReq.notify`, which tags the notification with the originating
    // request id. Sending it bare down a transport would target the standalone SSE stream, which
    // stateless serving does not have at all — so nothing would arrive.
    running = await createApp()

    const client = new LegacyClient({ name: 'legacy-client', version: '1.0.0' })
    await client.connect(
      new LegacyTransport(new URL(running.url), {
        requestInit: { headers: { Authorization: 'Bearer key-alice' } }
      })
    )

    const seen: number[] = []
    await client.callTool({ name: 'whoami', arguments: {} }, undefined, {
      onprogress: (p: any) => seen.push(p.progress)
    })

    expect(seen).toEqual([0, 100])
    await client.close()
  })
})

describe('era discrimination on the wire', () => {
  it('answers server/discover with the modern revision', async () => {
    // The probe a modern client opens with, and the method whose absence sent every dual-era client
    // down the legacy fallback path before this migration. Spelled out on the wire rather than
    // through the client, because the three things that make a request modern — the `_meta`
    // envelope, the `MCP-Protocol-Version` header and the routable `Mcp-Method` header — are exactly
    // what a gateway or proxy in front of this endpoint has to preserve.
    running = await createKoaApp()

    const { status, body } = await modernRpc(running.url, 'server/discover')

    expect(status).toBe(200)
    expect(body.error).toBeUndefined()
    expect(body.result.supportedVersions).toContain(MODERN_VERSION)
    expect(body.result.capabilities.tools).toBeDefined()
  })

  it('serves an ordinary modern request off the same envelope', async () => {
    running = await createKoaApp()

    const { status, body } = await modernRpc(running.url, 'tools/list')

    expect(status).toBe(200)
    expect(body.result.tools.map((t: any) => t.name).sort()).toEqual(['boom', 'echo_json', 'whoami'])
  })

  it('serves a legacy initialize on the same endpoint', async () => {
    running = await createKoaApp()

    const { status, body } = await rpc(running.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    })

    expect(status).toBe(200)
    expect(body.result.protocolVersion).toBe('2025-11-25')
  })

  it.each(LEGACY_VERSIONS)('negotiates a legacy client on %s', async (protocolVersion) => {
    running = await createKoaApp()

    const { status, body } = await rpc(running.url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion,
        capabilities: {},
        clientInfo: { name: 'test-client', version: '1.0.0' }
      }
    })

    expect(status).toBe(200)
    expect(body.result.protocolVersion).toBe(protocolVersion)
  })

  it('rejects a request that claims 2026-07-28 without the required envelope', async () => {
    // The header says modern, the body is legacy-shaped. Classifying that as either era silently
    // would be worse than refusing it, so it has to be a legible 4xx naming what is missing.
    running = await createKoaApp()

    const { status, body } = await rpc(
      running.url,
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      { 'MCP-Protocol-Version': MODERN_VERSION }
    )

    expect(status).toBe(400)
    expect(body.error.message).toMatch(/envelope/i)
  })
})
