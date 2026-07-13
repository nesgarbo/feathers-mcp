// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#custom-services
import type { Params, ServiceInterface } from '@feathersjs/feathers'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js'
import type { ServerResponse } from 'node:http'
import { randomUUID } from 'node:crypto'
import type { BaseTool, ToolResponse } from '../mcp/base-tool.js'
import { getRawHttp, type McpApplication } from '../mcp/app.js'
import { debug, warn } from '../mcp/logger.js'
import { typeboxToZodObject } from '../utils/typebox-to-zod-object.js'

export interface McpServiceOptions {
  app: McpApplication
  /** Advertised to MCP clients on `initialize`. */
  serverInfo?: { name: string; version: string }
  /**
   * Drop a session after this long without a request. The MCP client does not send DELETE on a
   * plain `close()` — only on an explicit `terminateSession()` — so the ordinary disconnect never
   * fires `transport.onclose` and the session, with the user object and API key in its params,
   * would otherwise be pinned for the life of the process. 0 disables expiry.
   */
  sessionTtlMs?: number
  /**
   * Hard ceiling on concurrent sessions. Without one, a single valid API key looping `initialize`
   * allocates unbounded `McpServer` instances. 0 disables the cap.
   */
  maxSessions?: number
}

const DEFAULT_SESSION_TTL_MS = 30 * 60 * 1000
const DEFAULT_MAX_SESSIONS = 1000

export interface McpParams extends Params {}

export interface EmitOptions {
  progress?: number
  total?: number
  level?: 'debug' | 'info' | 'warning' | 'error'
  type?: 'progress' | 'log'
}

export type EmitFunction = (message: string, options?: EmitOptions | number) => void

const SESSION_ID_HEADER_NAME = 'mcp-session-id'
const JSON_RPC = '2.0'

// JSON-RPC error codes. -32000..-32099 is the implementation-defined server range.
const ERROR_INVALID_REQUEST = -32600
const ERROR_INTERNAL = -32603
const ERROR_UNKNOWN_SESSION = -32001
const ERROR_UNAUTHENTICATED = -32002
const ERROR_SESSION_FORBIDDEN = -32003
const ERROR_TOO_MANY_SESSIONS = -32004

/**
 * One MCP session. The `McpServer` is deliberately per-session rather than shared: the SDK's
 * `Protocol.connect()` keeps a single `_transport` slot and overwrites it on every connect, so a
 * server shared across sessions routes every response — and every `extra.sessionId` — to whichever
 * session connected last.
 */
interface McpSession {
  id: string
  server: McpServer
  transport: StreamableHTTPServerTransport
  ownerId: string
  lastSeenAt: number
  /** Params of the request that opened the session; the fallback when a call has no request id. */
  params: McpParams
  /**
   * Params keyed by JSON-RPC request id. A single session can have several requests in flight, and
   * they do not all carry the same headers or query — keeping one mutable `params` on the session
   * would let a later request's context leak into an earlier request's still-running handler.
   */
  paramsByRequest: Map<string | number, McpParams>
}

/**
 * A host app's user id field is whatever its `authentication.entityId` says (or the users service's
 * own id property). Hard-coding `id ?? _id` locks out anyone using, say, `uuid` — and since a
 * session cannot be opened without a principal to bind it to, that would be a hard 401.
 */
const getOwnerId = (app: McpApplication, params?: McpParams): string | undefined => {
  const user = (params as any)?.user
  if (!user) return undefined

  const authConfig = app.get('authentication') ?? {}
  const entityService: any = authConfig.service ? app.service(authConfig.service) : undefined
  const idField: string = authConfig.entityId ?? entityService?.id ?? 'id'

  const id = user[idField] ?? user.id ?? user._id
  return id === undefined || id === null ? undefined : String(id)
}

/**
 * Written straight to the raw response rather than returned from the service method: the Koa
 * transport middleware sets `ctx.respond = false` so the MCP transport owns the socket, which
 * means anything this service returns is silently dropped.
 */
const writeJsonRpcError = (
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
  id: string | number | null = null
): void => {
  if (res.headersSent) {
    warn(`cannot send JSON-RPC error (${code}: ${message}), response already sent`)
    return
  }
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify({ jsonrpc: JSON_RPC, id, error: { code, message } }))
}

export class McpServerService<ServiceParams extends McpParams = McpParams>
  implements ServiceInterface<any, any, ServiceParams, never>
{
  private sessions = new Map<string, McpSession>()

  constructor(public options: McpServiceOptions) {}

  /** POST — every JSON-RPC message the client sends, including `initialize`. */
  async create(data: any, params?: ServiceParams): Promise<any> {
    const { req, res } = getRawHttp(this.options.app, params)
    const sessionId = this.getSessionId(params)
    const messageId = data?.id ?? null

    debug('POST', { method: data?.method, sessionId })
    this.expireIdleSessions()

    try {
      if (!sessionId) {
        if (!isInitializeRequest(data)) {
          writeJsonRpcError(
            res,
            400,
            ERROR_INVALID_REQUEST,
            `Missing ${SESSION_ID_HEADER_NAME} header for method '${data?.method}'`,
            messageId
          )
          return
        }
        await this.openSession(data, params as McpParams, req, res)
        return
      }

      const session = this.sessions.get(sessionId)
      if (!session) {
        writeJsonRpcError(res, 404, ERROR_UNKNOWN_SESSION, 'Unknown or expired session', messageId)
        return
      }
      if (!this.ownsSession(session, params)) {
        writeJsonRpcError(res, 403, ERROR_SESSION_FORBIDDEN, 'Session belongs to another principal', messageId)
        return
      }

      session.lastSeenAt = Date.now()
      const boundIds = bindParams(session, data, params as McpParams)

      try {
        await session.transport.handleRequest(req, res, data)
      } finally {
        // `handleRequest` resolves only after the tool handler has run (measured), so this cannot
        // evict params a handler still needs. It is what bounds the map: the SDK skips the tool
        // callback entirely for an unknown tool name or a schema-validation failure, and without
        // this every such call would pin the caller's params — user object and raw API key — for
        // the life of the session.
        for (const id of boundIds) session.paramsByRequest.delete(id)
      }
    } catch (error) {
      // Deliberately not closing the session: one malformed message should not evict a client that
      // is otherwise healthy. A genuinely dead transport fires `onclose`, which does evict it.
      warn('error handling MCP request:', error)
      writeJsonRpcError(
        res,
        500,
        ERROR_INTERNAL,
        error instanceof Error ? error.message : String(error),
        messageId
      )
    }
  }

  /**
   * GET — the standalone SSE stream the client opens to receive server-initiated messages. MCP GETs
   * the bare endpoint, and an id-less GET maps to `find` in Feathers, so this is the one that
   * actually runs; `get` is the same handler for `GET /mcp-server/:id`.
   */
  async find(params: ServiceParams): Promise<any> {
    const { req, res } = getRawHttp(this.options.app, params)
    const session = this.requireSession(params, res)
    if (!session) return

    await session.transport.handleRequest(req, res)
  }

  async get(_id: string, params: ServiceParams): Promise<any> {
    return this.find(params)
  }

  /** DELETE — explicit session termination, per the MCP Streamable HTTP spec. */
  async remove(_id: null | string, params: ServiceParams): Promise<any> {
    const { req, res } = getRawHttp(this.options.app, params)
    const session = this.requireSession(params, res)
    if (!session) return

    await session.transport.handleRequest(req, res)
    this.closeSession(session.id)
  }

  async teardown(): Promise<void> {
    debug(`tearing down ${this.sessions.size} MCP session(s)`)
    await Promise.all(
      [...this.sessions.values()].map(async (session) => {
        try {
          await session.transport.close()
          await session.server.close()
        } catch (error) {
          warn(`error closing session ${session.id}:`, error)
        }
      })
    )
    this.sessions.clear()
  }

  private async openSession(
    data: any,
    params: McpParams,
    req: any,
    res: ServerResponse
  ): Promise<void> {
    const ownerId = getOwnerId(this.options.app, params)
    if (!ownerId) {
      // Without a stable principal there is nothing to bind the session to, so a later request
      // carrying this session id could not be checked against its creator.
      writeJsonRpcError(res, 401, ERROR_UNAUTHENTICATED, 'An authenticated user is required', data?.id ?? null)
      return
    }

    const maxSessions = this.options.maxSessions ?? DEFAULT_MAX_SESSIONS
    if (maxSessions > 0 && this.sessions.size >= maxSessions) {
      warn(`refusing to open a session: at the ${maxSessions}-session cap`)
      writeJsonRpcError(res, 503, ERROR_TOO_MANY_SESSIONS, 'Too many active sessions', data?.id ?? null)
      return
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID()
    })

    // Built before the id is known (the transport only assigns one while handling this request)
    // and mutated in place, so the tool closures below always read live session state.
    const session: McpSession = {
      id: '',
      server: undefined as unknown as McpServer,
      transport,
      ownerId,
      lastSeenAt: Date.now(),
      params,
      paramsByRequest: new Map()
    }
    session.server = this.createServer(session)

    transport.onclose = () => this.closeSession(session.id)
    transport.onerror = (error) => warn(`transport error on session ${session.id}:`, error)

    await session.server.connect(transport)
    await transport.handleRequest(req, res, data)

    if (!transport.sessionId) {
      warn('transport did not assign a session id; session not retained')
      return
    }

    session.id = transport.sessionId
    this.sessions.set(session.id, session)
    debug(`session opened: ${session.id} (owner ${ownerId})`)
  }

  private createServer(session: McpSession): McpServer {
    const { name, version } = this.options.serverInfo ?? {
      name: 'feathers-mcp-server',
      version: '1.0.0'
    }
    const server = new McpServer({ name, version }, { capabilities: { tools: {}, logging: {} } })

    const tools: BaseTool<any, any, any>[] = this.options.app.get('mcpToolHandler').getForMcp()

    for (const tool of tools) {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: typeboxToZodObject(tool.inputSchema).shape
        },
        async (args: any, extra: any) => {
          debug(`tool call on session ${session.id}: ${tool.name}`)
          const emit = createEmit(extra, extra?._meta?.progressToken)
          // The params of the very request that carried this call, not whatever landed on the
          // session most recently — a session can have several calls in flight.
          const callParams = session.paramsByRequest.get(extra?.requestId) ?? session.params

          try {
            const result = await tool.handler(args, callParams, emit)
            return transformToMcpResponse(result)
          } catch (error) {
            warn(`tool '${tool.name}' failed:`, error)
            return {
              content: [
                { type: 'text' as const, text: error instanceof Error ? error.message : String(error) }
              ],
              isError: true
            }
          } finally {
            session.paramsByRequest.delete(extra?.requestId)
          }
        }
      )
    }

    return server
  }

  private getSessionId(params: Params | undefined): string | undefined {
    const value = params?.headers?.[SESSION_ID_HEADER_NAME]
    return typeof value === 'string' ? value : undefined
  }

  private ownsSession(session: McpSession, params: Params | undefined): boolean {
    return session.ownerId === getOwnerId(this.options.app, params)
  }

  /** Resolves the caller's session, writing the appropriate JSON-RPC error if it cannot. */
  private requireSession(params: Params, res: ServerResponse): McpSession | undefined {
    this.expireIdleSessions()

    const sessionId = this.getSessionId(params)
    const session = sessionId ? this.sessions.get(sessionId) : undefined

    if (!session) {
      writeJsonRpcError(res, 404, ERROR_UNKNOWN_SESSION, 'Unknown or expired session')
      return
    }
    if (!this.ownsSession(session, params)) {
      writeJsonRpcError(res, 403, ERROR_SESSION_FORBIDDEN, 'Session belongs to another principal')
      return
    }

    // A client holding only the SSE stream open is still a live client.
    session.lastSeenAt = Date.now()
    return session
  }

  private closeSession(sessionId: string | undefined): void {
    if (!sessionId) return

    const session = this.sessions.get(sessionId)
    if (!session) return

    // Delete first: `server.close()` closes the transport, whose `onclose` calls back in here, and
    // the missing entry is what stops that from recursing.
    this.sessions.delete(sessionId)
    session.paramsByRequest.clear()
    session.server.close().catch((error) => warn(`error closing server for ${sessionId}:`, error))

    debug(`session closed: ${sessionId}`)
  }

  /**
   * Swept lazily on each POST rather than on a timer: a library should not hold an interval open in
   * a host app's event loop just to reap its own bookkeeping.
   */
  private expireIdleSessions(): void {
    const ttl = this.options.sessionTtlMs ?? DEFAULT_SESSION_TTL_MS
    if (ttl <= 0) return

    const cutoff = Date.now() - ttl
    for (const session of this.sessions.values()) {
      if (session.lastSeenAt < cutoff) {
        debug(`session expired: ${session.id}`)
        this.closeSession(session.id)
      }
    }
  }
}

/**
 * Remembers, per in-flight `tools/call`, the params of the request that carried it, so the handler
 * can be given its own caller's Feathers context. Only `tools/call` needs this, which is also what
 * keeps the map bounded — every entry is removed by the handler it was recorded for.
 */
const bindParams = (session: McpSession, data: any, params: McpParams): (string | number)[] => {
  session.params = params
  const ids: (string | number)[] = []

  for (const message of Array.isArray(data) ? data : [data]) {
    if (message?.method === 'tools/call' && message.id !== undefined && message.id !== null) {
      session.paramsByRequest.set(message.id, params)
      ids.push(message.id)
    }
  }

  return ids
}

/**
 * Notifications go out through the SDK's `extra.sendNotification`, which tags them with the
 * originating request id so they land on the same stream as the tool call. Sending straight down
 * the transport would target the standalone SSE stream, which a client that only POSTs never opens.
 */
const createEmit = (extra: any, progressToken?: string | number): EmitFunction => {
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
          method: 'notifications/message' as const,
          params: { level, logger: 'feathers-mcp', data: message }
        }

    // Fire-and-forget: a tool must not fail because a progress update could not be delivered
    // (e.g. the client already disconnected).
    void extra.sendNotification(notification).catch((error: unknown) => {
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
    serverInfo: app.get('mcpServerInfo'),
    sessionTtlMs: app.get('mcpSessionTtlMs'),
    maxSessions: app.get('mcpMaxSessions')
  }
}
