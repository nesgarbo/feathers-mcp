// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#custom-services
import type { Params, ServiceInterface } from '@feathersjs/feathers'
import { toNodeHandler } from '@modelcontextprotocol/node'
import {
  createMcpHandler,
  McpServer,
  type McpHttpHandler,
  type McpRequestContext,
  type ServerContext
} from '@modelcontextprotocol/server'
import type { ZodObject, ZodRawShape } from 'zod'
import type { BaseTool, ToolResponse } from '../mcp/base-tool.js'
import { getRawHttp, type McpApplication } from '../mcp/app.js'
import { debug, warn } from '../mcp/logger.js'
import { typeboxToZodObject } from '../utils/typebox-to-zod-object.js'

export interface McpServiceOptions {
  app: McpApplication
  /** Advertised to MCP clients — on `initialize` in the 2025 era, on `server/discover` in the 2026 one. */
  serverInfo?: { name: string; version: string }
}

export interface McpParams extends Params {}

export interface EmitOptions {
  progress?: number
  total?: number
  level?: 'debug' | 'info' | 'warning' | 'error'
  type?: 'progress' | 'log'
}

export type EmitFunction = (message: string, options?: EmitOptions | number) => void

/**
 * The channel the caller's Feathers params ride to the per-request server factory on.
 *
 * `toNodeHandler` forwards `req.auth` verbatim as the handler's pass-through `authInfo`, and
 * `createMcpHandler` hands that straight back to the factory on `ctx.authInfo` — the documented hook
 * for a factory that varies by principal. Nothing in the SDK reads, validates or transmits it.
 */
const FEATHERS_PARAMS = 'feathers-mcp/params'

/** A tool with its input schema already converted, so conversion happens once at boot, not per call. */
interface RegisteredTool {
  tool: BaseTool<any, any, any>
  inputSchema: ZodObject<ZodRawShape>
}

/**
 * MCP as a Feathers custom service.
 *
 * **Stateless, both eras, one handler.** `createMcpHandler` classifies every request by its own
 * content: a 2026-07-28 request (the per-request `_meta` envelope) is served modern, anything else
 * falls to `legacy: 'stateless'`, which answers a 2025-era client with a fresh instance per request.
 * So there is no session map, no idle sweep, no session cap and no session ownership check — a
 * request carries its own identity or it is not served, and the library holds nothing between
 * requests. That also retires the old "does not scale horizontally without sticky sessions" caveat.
 *
 * The consequence worth knowing: 2025-era GET (the standalone SSE stream) and DELETE (session
 * termination) are session operations, and stateless serving answers them `405`. Nothing here used
 * the standalone stream — tool notifications go out on the stream of the call that produced them.
 */
export class McpServerService<ServiceParams extends McpParams = McpParams>
  implements ServiceInterface<any, any, ServiceParams, never>
{
  private readonly handler: McpHttpHandler
  private readonly nodeHandler: ReturnType<typeof toNodeHandler>
  /**
   * Converted once here rather than inside the factory: the factory runs per request, and a bad
   * TypeBox schema should fail at boot with the tool's name on it, not as a 500 on someone's first
   * `tools/list`.
   */
  private readonly tools: RegisteredTool[]

  constructor(public options: McpServiceOptions) {
    const registered: BaseTool<any, any, any>[] = options.app.get('mcpToolHandler')?.getForMcp() ?? []
    this.tools = registered.map((tool) => ({ tool, inputSchema: typeboxToZodObject(tool.inputSchema) }))

    this.handler = createMcpHandler((ctx) => this.createServer(ctx), {
      legacy: 'stateless',
      onerror: (error) => warn('MCP handler error:', error)
    })
    this.nodeHandler = toNodeHandler(this.handler, {
      onerror: (error) => warn('MCP request could not be served:', error)
    })
  }

  /** POST — every JSON-RPC message, both eras. */
  async create(data: any, params?: ServiceParams): Promise<any> {
    debug('POST', { method: data?.method })
    return this.serve(params, data)
  }

  /**
   * GET — the 2025-era standalone SSE stream. MCP GETs the bare endpoint, and an id-less GET maps to
   * `find` in Feathers, so this is the one that actually runs. Stateless serving answers `405`;
   * forwarded anyway so the refusal is the SDK's own, in the shape a client expects.
   */
  async find(params: ServiceParams): Promise<any> {
    return this.serve(params)
  }

  async get(_id: string, params: ServiceParams): Promise<any> {
    return this.serve(params)
  }

  /** DELETE — 2025-era session termination; likewise `405`, with nothing to terminate. */
  async remove(_id: null | string, params: ServiceParams): Promise<any> {
    return this.serve(params)
  }

  async teardown(): Promise<void> {
    debug('closing the MCP handler')
    await this.handler.close()
  }

  private async serve(params: ServiceParams | undefined, data?: unknown): Promise<void> {
    const { req, res } = getRawHttp(this.options.app, params)

    // Read back on `ctx.authInfo` in `createServer`. The Feathers hooks have already authenticated
    // this request, so `params.user` is set and the tools built below run as the right principal.
    ;(req as any).auth = {
      token: '',
      clientId: 'feathers-mcp',
      scopes: [],
      extra: { [FEATHERS_PARAMS]: params }
    }

    // `data` is the already-parsed body (Koa's bodyParser, Express's json()), so nothing tries to
    // read the Node stream a second time.
    await this.nodeHandler(req as any, res as any, data)
  }

  /**
   * Builds the server for exactly one request. Tool callbacks close over that request's params, so a
   * handler cannot be handed anyone else's context — the property the old per-session
   * `paramsByRequest` map existed to preserve, now a consequence of the shape rather than
   * bookkeeping that has to be swept.
   */
  private createServer(ctx: McpRequestContext): McpServer {
    const { name, version } = this.options.serverInfo ?? {
      name: 'feathers-mcp-server',
      version: '1.0.0'
    }
    const server = new McpServer({ name, version }, { capabilities: { tools: {}, logging: {} } })

    const params = (ctx.authInfo?.extra?.[FEATHERS_PARAMS] as McpParams | undefined) ?? {}

    for (const { tool, inputSchema } of this.tools) {
      server.registerTool(
        tool.name,
        { description: tool.description, inputSchema },
        async (args: any, toolCtx: ServerContext) => {
          debug(`tool call (${ctx.era} era): ${tool.name}`)

          try {
            return transformToMcpResponse(await tool.handler(args, params, createEmit(toolCtx)))
          } catch (error) {
            warn(`tool '${tool.name}' failed:`, error)
            return {
              content: [
                { type: 'text' as const, text: error instanceof Error ? error.message : String(error) }
              ],
              isError: true
            }
          }
        }
      )
    }

    return server
  }
}

/**
 * Notifications go out through `ctx.mcpReq.notify`, which tags them with the originating request id
 * so they land on the stream of the call that produced them. Sending straight down a transport would
 * target the standalone SSE stream, which stateless serving does not have at all.
 */
const createEmit = (ctx: ServerContext): EmitFunction => {
  const progressToken = ctx.mcpReq._meta?.progressToken

  return (message, options) => {
    // A bare number means progress — the signature this shipped with.
    const opts: EmitOptions = typeof options === 'number' ? { progress: options } : options ?? {}
    const { progress, total = 100, level = 'info', type } = opts

    const asProgress =
      progressToken !== undefined &&
      (type === 'progress' || (type !== 'log' && progress !== undefined))

    const notification = asProgress
      ? {
          method: 'notifications/progress' as const,
          params: { progressToken, progress: progress ?? 0, total, message }
        }
      : {
          // Deprecated by 2026-07-28 (SEP-2577) but functional for at least twelve months, and still
          // the only in-band log channel a 2025-era client understands.
          method: 'notifications/message' as const,
          params: { level, logger: 'feathers-mcp', data: message }
        }

    // Fire-and-forget: a tool must not fail because a progress update could not be delivered
    // (e.g. the client already disconnected).
    void ctx.mcpReq.notify(notification).catch((error: unknown) => {
      warn('failed to send notification:', error)
    })
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** Maps the library's `ToolResponse` onto the content blocks the MCP spec defines. */
export const transformToMcpResponse = (result: ToolResponse<any>) => {
  const { json, image, resource, text } = result ?? {}

  const content = [
    ...(json ? [{ type: 'text' as const, text: JSON.stringify(json.result) }] : []),
    ...(text ? [{ type: 'text' as const, text: text.data }] : []),
    // ImageContent is flat: `data` is raw base64, with no `data:` URI prefix.
    ...(image ? [{ type: 'image' as const, data: image.data, mimeType: image.mimeType }] : []),
    // EmbeddedResource carries base64 payloads under `blob`, not `data`.
    ...(resource
      ? [
          {
            type: 'resource' as const,
            resource: {
              uri: resource.resource.uri,
              mimeType: resource.resource.mimeType,
              blob: resource.resource.data
            }
          }
        ]
      : [])
  ]

  // The result itself, not a `{ result: … }` wrapper — structuredContent is meant to match the
  // tool's declared output shape, and the wrapper matched nothing. Spec requires an object, so a
  // scalar result travels as text only.
  const structured = json && isPlainObject(json.result) ? { structuredContent: json.result } : {}

  return { content, ...structured } as any
}

export const getOptions = (app: McpApplication): McpServiceOptions => {
  return {
    app,
    serverInfo: app.get('mcpServerInfo')
  }
}
