import { mcpServer } from './mcp-server/mcp-server.js'
import { McpToolHandler } from './mcp/mcp-tool-handler.js'
import { warn } from './mcp/logger.js'
import type { McpApplication } from './mcp/app.js'
import type { BaseTool } from './mcp/base-tool.js'

export type {
  EmitFunction,
  EmitOptions,
  McpParams,
  McpServerService,
  McpServiceOptions
} from './mcp-server/mcp-server.class.js'
export { mcpServerMethods, mcpServerPath } from './mcp-server/mcp-server.shared.js'
export { isKoaApp } from './mcp/app.js'
export type { McpApplication } from './mcp/app.js'
export { BaseTool } from './mcp/base-tool.js'
export type {
  ImageToolResponse,
  JSONToolResponse,
  ResourceToolResponse,
  TextToolResponse,
  ToolResponse,
  ToolResponseType
} from './mcp/base-tool.js'
export type { InferMcpToolType } from './mcp/infer-mcp-tool-type.js'
// Exported so host apps can `declare module 'feathers-mcp'` and augment McpToolMap with their own
// tool names — the augmentation only merges into the interface the library actually uses if that
// interface is part of the public surface.
export type { McpToolBase, McpToolMap } from './mcp/mcp-tool-types.js'
export { McpToolHandler } from './mcp/mcp-tool-handler.js'
export { default as allowMcpApiKey } from './mcp/allow-mcp-api-key.js'
export { McpApiKeyStrategy } from './mcp/mcp-api-key-authentication-strategy.js'

export type ToolClass = new (app: McpApplication) => BaseTool<any, any, any>

export interface FeathersMcpOptions {
  tools?: ToolClass[]
  /**
   * Advertised to MCP clients — on `initialize` in the 2025 era, on `server/discover` in the 2026
   * one. Defaults to the library's own name/version.
   */
  serverInfo?: { name: string; version: string }
  /**
   * @deprecated No-op since the move to MCP 2026-07-28. Serving is stateless — there are no
   * sessions to expire — so this is accepted and ignored rather than breaking existing calls.
   */
  sessionTtlMs?: number
  /**
   * @deprecated No-op since the move to MCP 2026-07-28. Serving is stateless, so there is no
   * session count to cap; accepted and ignored rather than breaking existing calls.
   */
  maxSessions?: number
  /**
   * Name of the registered Feathers authentication strategy to run for every MCP call. Defaults
   * to 'mcpApiKey' — this library's own `McpApiKeyStrategy`, registered under that name. If your
   * app already has its own API-key/token strategy registered, point this at it instead; you
   * don't have to register `McpApiKeyStrategy` at all.
   */
  authStrategy?: string
  /**
   * Property the extracted header value is placed under on the authentication request object
   * built for `authStrategy`. Only matters when `authStrategy` points at a pre-existing strategy
   * expecting a field other than `apiKey`. Defaults to 'apiKey'.
   */
  authField?: string
}

export function feathersMcp(options: FeathersMcpOptions = {}) {
  return (app: McpApplication) => {
    const mcpToolHandler = new McpToolHandler(app)
    app.set('mcpToolHandler', mcpToolHandler)
    if (options.serverInfo) {
      app.set('mcpServerInfo', options.serverInfo)
    }
    if (options.sessionTtlMs !== undefined || options.maxSessions !== undefined) {
      warn(
        'sessionTtlMs/maxSessions are no-ops: MCP serving is stateless, so there are no sessions ' +
          'to expire or cap. Remove them from feathersMcp().'
      )
    }
    if (options.authStrategy !== undefined) {
      app.set('mcpAuthStrategy', options.authStrategy)
    }
    if (options.authField !== undefined) {
      app.set('mcpAuthField', options.authField)
    }

    for (const Tool of options.tools ?? []) {
      mcpToolHandler.register(new Tool(app))
    }

    app.configure(mcpServer)
  }
}
