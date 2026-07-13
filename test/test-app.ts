import { AuthenticationService } from '@feathersjs/authentication'
import { NotFound } from '@feathersjs/errors'
import express, { rest as expressRest, json, errorHandler as expressErrorHandler } from '@feathersjs/express'
import type { Application as ExpressApplication } from '@feathersjs/express'
import { feathers, type Application as FeathersApplication } from '@feathersjs/feathers'
import { koa, rest as koaRest, bodyParser, errorHandler as koaErrorHandler } from '@feathersjs/koa'
import type { Application as KoaApplication } from '@feathersjs/koa'
import { Static, Type } from '@feathersjs/typebox'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { BaseTool, McpApiKeyStrategy, ToolResponse, feathersMcp } from '../src/index.js'
import type { McpParams } from '../src/index.js'
import type { McpApplication } from '../src/mcp/app.js'

export const USERS = [
  { id: 1, email: 'alice@example.com' },
  { id: 2, email: 'bob@example.com' }
]

export const API_KEYS = [
  { id: 'key-alice', userId: 1, isActive: true },
  { id: 'key-bob', userId: 2, isActive: true },
  { id: 'key-revoked', userId: 1, isActive: false }
]

/** Just enough of a Feathers service to back the auth strategy. */
class LookupService {
  constructor(
    private readonly rows: any[],
    // Feathers' AuthenticationService reads `id` to know the entity's id field.
    readonly id = 'id'
  ) {}

  async get(id: string | number) {
    const row = this.rows.find((r) => String(r[this.id]) === String(id))
    if (!row) throw new NotFound(`No record found for id '${id}'`)
    return row
  }
}

const WHOAMI = 'whoami' as const

/** Reports which Feathers user the call ran as — the whole point of the session/params binding. */
class WhoamiTool extends BaseTool<typeof WHOAMI, typeof WhoamiTool.inputSchema, typeof WhoamiTool.outputSchema> {
  static inputSchema = Type.Object({
    delayMs: Type.Optional(Type.Number({ description: 'Stall before answering, to force overlap' }))
  })
  static outputSchema = Type.String()

  name = WHOAMI
  description = 'Returns the email of the authenticated user'
  inputSchema = WhoamiTool.inputSchema
  outputSchema = WhoamiTool.outputSchema
  expose = { mcp: true, openai: true }

  async handler(
    { delayMs }: Static<typeof WhoamiTool.inputSchema>,
    params: McpParams,
    emit: (message: string, progress?: number) => void
  ): Promise<ToolResponse<string>> {
    emit('looking up caller', 0)
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
    }
    emit('done', 100)
    return { text: { type: 'text', data: (params as any).user?.email ?? 'anonymous' } }
  }
}

const HIDDEN = 'hidden_tool' as const

class HiddenTool extends BaseTool<typeof HIDDEN, typeof HiddenTool.inputSchema, typeof HiddenTool.outputSchema> {
  static inputSchema = Type.Object({})
  static outputSchema = Type.String()

  name = HIDDEN
  description = 'Should never reach MCP clients'
  inputSchema = HiddenTool.inputSchema
  outputSchema = HiddenTool.outputSchema
  expose = { mcp: false, openai: true }

  async handler(): Promise<ToolResponse<string>> {
    return { text: { type: 'text', data: 'nope' } }
  }
}

const BOOM = 'boom' as const

class BoomTool extends BaseTool<typeof BOOM, typeof BoomTool.inputSchema, typeof BoomTool.outputSchema> {
  static inputSchema = Type.Object({})
  static outputSchema = Type.String()

  name = BOOM
  description = 'Always throws'
  inputSchema = BoomTool.inputSchema
  outputSchema = BoomTool.outputSchema
  expose = { mcp: true, openai: true }

  async handler(): Promise<ToolResponse<string>> {
    throw new Error('tool exploded')
  }
}

const ECHO_JSON = 'echo_json' as const

/** Returns a `json` ToolResponse, which is what produces MCP `structuredContent`. */
class EchoJsonTool extends BaseTool<
  typeof ECHO_JSON,
  typeof EchoJsonTool.inputSchema,
  typeof EchoJsonTool.outputSchema
> {
  static inputSchema = Type.Object({ value: Type.String() })
  static outputSchema = Type.Object({ echoed: Type.String() })

  name = ECHO_JSON
  description = 'Echoes its input back as structured JSON'
  inputSchema = EchoJsonTool.inputSchema
  outputSchema = EchoJsonTool.outputSchema
  expose = { mcp: true, openai: true }

  async handler({ value }: Static<typeof EchoJsonTool.inputSchema>) {
    return { json: { type: 'json' as const, result: { echoed: value } } }
  }
}

export interface TestAppOptions {
  sessionTtlMs?: number
  maxSessions?: number
  /** Swaps the users service for one whose id field is `uuid`, as some host apps have. */
  uuidUsers?: boolean
}

const configureCommon = (app: McpApplication, options: TestAppOptions = {}) => {
  const users = options.uuidUsers
    ? USERS.map(({ id, email }) => ({ uuid: `u-${id}`, email }))
    : USERS
  const apiKeys = options.uuidUsers
    ? API_KEYS.map((k) => ({ ...k, userId: `u-${k.userId}` }))
    : API_KEYS

  app.set('authentication', {
    entity: 'user',
    entityId: options.uuidUsers ? 'uuid' : 'id',
    service: 'users',
    secret: 'test-secret-not-used-by-mcp-api-key',
    authStrategies: ['mcpApiKey'],
    mcpApiKey: { header: 'Authorization' }
  })

  app.use('users', new LookupService(users, options.uuidUsers ? 'uuid' : 'id'), {
    methods: ['get']
  })
  app.use('mcp-api-keys', new LookupService(apiKeys), { methods: ['get'] })

  const authentication = new AuthenticationService(app)
  authentication.register('mcpApiKey', new McpApiKeyStrategy())
  app.use('authentication', authentication)

  app.configure(
    feathersMcp({
      tools: [WhoamiTool, HiddenTool, BoomTool, EchoJsonTool],
      sessionTtlMs: options.sessionTtlMs,
      maxSessions: options.maxSessions
    })
  )
}

export interface TestApp {
  app: McpApplication
  url: string
  close: () => Promise<void>
}

/**
 * Building the app needs the concrete framework type — `app.use(middleware)` is a Koa/Express
 * thing, not a Feathers one. Only what the library itself touches is typed as `McpApplication`.
 */
type TransportApp = KoaApplication | ExpressApplication

const listen = async (app: TransportApp): Promise<TestApp> => {
  // Feathers overrides `listen` on both transports to resolve once the server is up, but Express's
  // own overloads survive in the union and confuse the call. Narrowed rather than detached — a
  // detached `app.listen` loses its `this`.
  const server: Server = await (app as KoaApplication).listen(0)
  const { port } = server.address() as AddressInfo

  return {
    app,
    url: `http://127.0.0.1:${port}/mcp-server`,
    close: async () => {
      await app.teardown()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  }
}

export const createKoaApp = async (options: TestAppOptions = {}): Promise<TestApp> => {
  const app = koa(feathers())
  app.use(koaErrorHandler())
  app.use(bodyParser())
  app.configure(koaRest())
  configureCommon(app, options)
  return listen(app)
}

// @feathersjs/express is CommonJS with a default export, and under NodeNext TypeScript types that
// default import as the module namespace rather than as the factory function. The runtime is fine;
// only the type needs restating.
const feathersExpress = express as unknown as (app: FeathersApplication) => ExpressApplication

export const createExpressApp = async (options: TestAppOptions = {}): Promise<TestApp> => {
  const app = feathersExpress(feathers())
  app.use(json())
  app.configure(expressRest())
  configureCommon(app, options)
  app.use(expressErrorHandler())
  return listen(app)
}
