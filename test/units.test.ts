import { Type } from '@feathersjs/typebox'
import { ImageContentSchema, EmbeddedResourceSchema, TextContentSchema } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'
import { NotFound } from '@feathersjs/errors'
import { transformToMcpResponse } from '../src/mcp-server/mcp-server.class.js'
import allowMcpApiKey from '../src/mcp/allow-mcp-api-key.js'
import { BaseTool } from '../src/mcp/base-tool.js'
import { McpApiKeyStrategy } from '../src/mcp/mcp-api-key-authentication-strategy.js'
import { McpToolHandler } from '../src/mcp/mcp-tool-handler.js'
import { typeboxToZod } from '../src/utils/typebox-to-zod.js'
import { typeboxToZodObject } from '../src/utils/typebox-to-zod-object.js'

describe('transformToMcpResponse', () => {
  it('emits text content the SDK accepts', () => {
    const { content } = transformToMcpResponse({ text: { type: 'text', data: 'hi' } })
    expect(TextContentSchema.safeParse(content[0]).success).toBe(true)
  })

  it('emits image content as a flat block with raw base64', () => {
    const { content } = transformToMcpResponse({
      image: { type: 'image', data: 'aGk=', mimeType: 'image/png' }
    })
    // The old shape nested these under `image`, which no MCP client could read.
    expect(content[0]).toEqual({ type: 'image', data: 'aGk=', mimeType: 'image/png' })
    expect(ImageContentSchema.safeParse(content[0]).success).toBe(true)
  })

  it('emits resource content with the payload under `blob`', () => {
    const { content } = transformToMcpResponse({
      resource: {
        type: 'resource',
        resource: { uri: 'file://a.pdf', mimeType: 'application/pdf', data: 'aGk=' }
      }
    })
    expect(content[0]).toMatchObject({ type: 'resource', resource: { blob: 'aGk=' } })
    expect(EmbeddedResourceSchema.safeParse(content[0]).success).toBe(true)
  })

  it('carries a json result as both text and structured content', () => {
    const result = transformToMcpResponse({ json: { type: 'json', result: { ok: 1 } } })
    expect(result.content[0]).toEqual({ type: 'text', text: '{"ok":1}' })
    // The result itself, not a `{ result: … }` wrapper — structuredContent is supposed to match the
    // tool's declared output shape.
    expect(result.structuredContent).toEqual({ ok: 1 })
  })

  it('omits structuredContent for a scalar json result, which the spec forbids', () => {
    const result = transformToMcpResponse({ json: { type: 'json', result: 'plain' } })
    expect(result.content[0]).toEqual({ type: 'text', text: '"plain"' })
    expect(result.structuredContent).toBeUndefined()
  })
})

describe('typeboxToZod', () => {
  it('marks non-required object properties optional', () => {
    const schema = typeboxToZodObject(
      Type.Object({ a: Type.String(), b: Type.Optional(Type.Number()) })
    )
    expect(schema.safeParse({ a: 'x' }).success).toBe(true)
    expect(schema.safeParse({ b: 1 }).success).toBe(false)
  })

  it('carries descriptions through, since they are what the model reads', () => {
    const schema = typeboxToZodObject(Type.Object({ a: Type.String({ description: 'the a' }) }))
    expect((schema.shape.a as any).description).toBe('the a')
  })

  it('keeps min/max alongside uniqueItems', () => {
    // uniqueItems used to be applied to the *base* schema, silently discarding minItems/maxItems.
    const schema = typeboxToZod(
      Type.Array(Type.Number(), { minItems: 2, maxItems: 3, uniqueItems: true })
    )
    expect(schema.safeParse([1]).success).toBe(false) // below minItems
    expect(schema.safeParse([1, 2, 3, 4]).success).toBe(false) // above maxItems
    expect(schema.safeParse([1, 1]).success).toBe(false) // not unique
    expect(schema.safeParse([1, 2]).success).toBe(true)
  })

  it('rejects a non-object tool input schema', () => {
    expect(() => typeboxToZodObject(Type.String())).toThrow(/must be a Type\.Object/i)
  })

  it('enforces Type.Literal instead of degrading it to any string', () => {
    // TypeBox emits a literal as `{ const: 'a', type: 'string' }`. Dispatching on `type` first made
    // every literal a bare z.string(), so a discriminator got zero validation.
    const schema = typeboxToZod(Type.Literal('a'))
    expect(schema.safeParse('a').success).toBe(true)
    expect(schema.safeParse('anything-goes').success).toBe(false)
  })

  it('enforces a union of literals, and advertises the allowed values', () => {
    const schema = typeboxToZodObject(
      Type.Object({ mode: Type.Union([Type.Literal('read'), Type.Literal('write')]) })
    )
    expect(schema.safeParse({ mode: 'read' }).success).toBe(true)
    expect(schema.safeParse({ mode: 'DROP TABLE' }).success).toBe(false)
  })

  it('enforces Type.Enum', () => {
    const schema = typeboxToZod(Type.Enum({ A: 'a', B: 'b' }))
    expect(schema.safeParse('a').success).toBe(true)
    expect(schema.safeParse('zzz').success).toBe(false)
  })

  it('keeps the entries of a Type.Record instead of silently emptying it', () => {
    // `z.object({})` strips unknown keys, so a Record used to reach the handler as `{}` — no error,
    // no warning, just missing data.
    const schema = typeboxToZod(Type.Record(Type.String(), Type.Number()))
    const parsed = schema.safeParse({ a: 1, b: 2 })
    expect(parsed.success).toBe(true)
    expect(parsed.data).toEqual({ a: 1, b: 2 })
    expect(schema.safeParse({ a: 'not-a-number' }).success).toBe(false)
  })

  it('keeps the positions of a Type.Tuple', () => {
    const schema = typeboxToZod(Type.Tuple([Type.String(), Type.Number()]))
    expect(schema.safeParse(['a', 1]).success).toBe(true)
    expect(schema.safeParse([1, 'a']).success).toBe(false)
    expect(schema.safeParse([{}, {}]).success).toBe(false)
  })

  it('accepts a schema whose top level carries a default', () => {
    // A top-level default wraps the schema in a ZodDefault, which used to fail the `instanceof
    // ZodObject` check — as a 500 on the first client's initialize, not at boot.
    const schema = typeboxToZodObject(Type.Object({ a: Type.String() }, { default: {} }))
    expect(schema.safeParse({ a: 'x' }).success).toBe(true)
  })

  it('applies a property default', () => {
    const schema = typeboxToZodObject(
      Type.Object({ limit: Type.Optional(Type.Number({ default: 10 })) })
    )
    expect(schema.parse({})).toEqual({ limit: 10 })
  })
})

describe('McpApiKeyStrategy', () => {
  const strategyFor = (keyService: { get: (id: string) => Promise<any> }) => {
    const strategy = new McpApiKeyStrategy()
    strategy.app = {
      get: () => ({ service: 'users' }),
      service: (name: string) =>
        name === 'users' ? { get: async () => ({ id: 1, email: 'a@b.c' }) } : keyService
    } as any
    return strategy
  }

  it('authenticates an active key', async () => {
    const strategy = strategyFor({ get: async () => ({ userId: 1, isActive: true }) })
    const result = await strategy.authenticate({ apiKey: 'k' }, {})
    expect(result.user).toEqual({ id: 1, email: 'a@b.c' })
  })

  it('rejects an inactive key', async () => {
    const strategy = strategyFor({ get: async () => ({ userId: 1, isActive: false }) })
    await expect(strategy.authenticate({ apiKey: 'k' }, {})).rejects.toThrow(/invalid api key/i)
  })

  it('rejects an unknown key', async () => {
    const strategy = strategyFor({
      get: async () => {
        throw new NotFound('nope')
      }
    })
    await expect(strategy.authenticate({ apiKey: 'k' }, {})).rejects.toThrow(/invalid api key/i)
  })

  it('surfaces infrastructure failures instead of calling them a bad key', async () => {
    // `.catch(() => undefined)` reported a database outage to the client as "Invalid API key", and
    // hid the outage from whoever had to fix it.
    const strategy = strategyFor({
      get: async () => {
        throw new Error('ECONNREFUSED')
      }
    })
    await expect(strategy.authenticate({ apiKey: 'k' }, {})).rejects.toThrow(/ECONNREFUSED/)
  })

  it('reads a pre-existing API-key service under its own path and field names', async () => {
    // A host app that already has its own API-key service shouldn't have to stand up a second one
    // named `mcp-api-keys` just to satisfy this library's defaults.
    const strategy = new McpApiKeyStrategy({
      service: 'partner-tokens',
      userIdField: 'ownerId',
      activeField: 'enabled'
    })
    strategy.app = {
      get: () => ({ service: 'users' }),
      service: (name: string) =>
        name === 'partner-tokens'
          ? { get: async () => ({ ownerId: 7, enabled: true }) }
          : { get: async () => ({ id: 7, email: 'owner@example.com' }) }
    } as any

    const result = await strategy.authenticate({ apiKey: 'k' }, {})
    expect(result.user).toEqual({ id: 7, email: 'owner@example.com' })
  })

  it('rejects when the custom active field is falsy', async () => {
    const strategy = new McpApiKeyStrategy({ service: 'partner-tokens', activeField: 'enabled' })
    strategy.app = {
      get: () => ({ service: 'users' }),
      service: () => ({ get: async () => ({ userId: 7, enabled: false }) })
    } as any

    await expect(strategy.authenticate({ apiKey: 'k' }, {})).rejects.toThrow(/invalid api key/i)
  })
})

describe('BaseTool.resourceFromUploadId', () => {
  class UploadTool extends BaseTool<'u', typeof UploadTool.schema, typeof UploadTool.schema> {
    static schema = Type.Object({})
    name = 'u' as const
    description = 'u'
    inputSchema = UploadTool.schema
    outputSchema = UploadTool.schema
    expose = { mcp: false }
    async handler() {
      return {}
    }
  }

  const appWith = (calls: any[]) =>
    ({
      service: () => ({
        get: async (id: unknown, params?: unknown) => {
          calls.push({ id, params })
          return { originalName: 'f.pdf', signedUrl: undefined }
        }
      })
    }) as any

  it("passes the caller's params through so the uploads service sees an external call", async () => {
    const calls: any[] = []
    const tool = new UploadTool(appWith(calls))
    const params = { provider: 'rest', user: { id: 1 } } as any

    await tool.resourceFromUploadId(7, 'file://x', params)

    // Calling `uploads.get(id)` with no params made it an internal call: `params.provider` is
    // undefined, so every `if (context.params.provider)` authorization hook is skipped. Since the
    // upload id comes from the model, that was an IDOR — any caller could name any user's upload.
    expect(calls).toEqual([{ id: 7, params }])
  })

  it('refuses to run without params rather than silently bypassing authorization', async () => {
    const tool = new UploadTool(appWith([]))
    await expect(tool.resourceFromUploadId(7, 'file://x', {} as any)).rejects.toThrow(/params/i)
  })
})

describe('McpToolHandler', () => {
  const makeTool = (name: string, expose: { mcp?: boolean; openai?: boolean }) =>
    ({
      name,
      description: name,
      inputSchema: Type.Object({}),
      outputSchema: Type.String(),
      expose
    }) as any

  const handler = () => new McpToolHandler({} as any)

  it('refuses to register two tools with the same name', () => {
    const h = handler()
    h.register(makeTool('dup', { mcp: true }))
    // Silently overwriting would leave clients calling one tool and getting another's behaviour.
    expect(() => h.register(makeTool('dup', { mcp: true }))).toThrow(/already registered/i)
  })

  it('splits tools by the exposure each surface asks for', () => {
    const h = handler()
    h.register(makeTool('both', { mcp: true, openai: true }))
    h.register(makeTool('mcp-only', { mcp: true, openai: false }))
    h.register(makeTool('openai-only', { mcp: false, openai: true }))

    expect(h.getForMcp().map((t) => t.name)).toEqual(['both', 'mcp-only'])
    expect(h.getForOpenAi().map((t) => t.name)).toEqual(['both', 'openai-only'])
  })

  it('builds the OpenAI schema from openai-exposed tools, not MCP-exposed ones', () => {
    const h = handler()
    h.register(makeTool('mcp-only', { mcp: true, openai: false }))
    h.register(makeTool('openai-only', { mcp: false, openai: true }))

    // These used to filter on `expose.mcp`, which made `expose.openai` inert and put exactly the
    // wrong tools in the OpenAI schema.
    const names = JSON.stringify(h.buildToolsSchema())
    expect(names).toContain('openai-only')
    expect(names).not.toContain('mcp-only')
  })
})

describe('allowMcpApiKey', () => {
  const run = async (
    headers: Record<string, string> | undefined,
    provider: string | undefined,
    header = 'Authorization'
  ) => {
    const context: any = {
      app: { get: () => ({ mcpApiKey: { header } }) },
      params: { provider, headers }
    }
    await allowMcpApiKey()(context, async () => {})
    return context.params.authentication
  }

  it('extracts a bearer key', async () => {
    expect(await run({ authorization: 'Bearer abc123' }, 'rest')).toEqual({
      strategy: 'mcpApiKey',
      apiKey: 'abc123'
    })
  })

  it('ignores a non-bearer scheme rather than truncating it', async () => {
    // `.substring(7)` used to turn `Basic zzzzzzzzzz` into a 7-shorter garbage key.
    expect(await run({ authorization: 'Basic zzzzzzzzzz' }, 'rest')).toBeUndefined()
  })

  it('reads a bare key from a custom header', async () => {
    // Configuring `header: 'x-api-key'` and sending the key bare — the obvious usage — used to 401
    // every request, because a `Bearer ` prefix was demanded regardless of the header.
    expect(await run({ 'x-api-key': 'abc123' }, 'rest', 'x-api-key')).toEqual({
      strategy: 'mcpApiKey',
      apiKey: 'abc123'
    })
  })

  it('still tolerates a Bearer prefix on a custom header', async () => {
    expect(await run({ 'x-api-key': 'Bearer abc123' }, 'rest', 'x-api-key')).toEqual({
      strategy: 'mcpApiKey',
      apiKey: 'abc123'
    })
  })

  it('leaves internal calls alone', async () => {
    expect(await run({ authorization: 'Bearer abc123' }, undefined)).toBeUndefined()
  })

  it('drives a pre-existing strategy under its own name and field', async () => {
    // A host app that already has its own API-key strategy shouldn't have to register this
    // library's strategy as 'mcpApiKey' — `strategy`/`field` point at whatever it already has.
    const context: any = {
      app: { get: () => ({ 'partner-api-key': { header: 'Authorization' } }) },
      params: { provider: 'rest', headers: { authorization: 'Bearer abc123' } }
    }
    await allowMcpApiKey({ strategy: 'partner-api-key', field: 'token' })(context, async () => {})
    expect(context.params.authentication).toEqual({ strategy: 'partner-api-key', token: 'abc123' })
  })

  it('survives a request with no headers', async () => {
    expect(await run(undefined, 'rest')).toBeUndefined()
  })
})
