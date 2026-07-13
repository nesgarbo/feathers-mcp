import { mcpServer } from './mcp-server/mcp-server.js'
import { McpToolHandler } from './mcp/mcp-tool-handler.js'
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
  /** Advertised to MCP clients on `initialize`. Defaults to the library's own name/version. */
  serverInfo?: { name: string; version: string }
  /** Idle timeout before a session is dropped. Defaults to 30 minutes; 0 disables expiry. */
  sessionTtlMs?: number
  /** Ceiling on concurrent sessions. Defaults to 1000; 0 disables the cap. */
  maxSessions?: number
}

export function feathersMcp(options: FeathersMcpOptions = {}) {
  return (app: McpApplication) => {
    const mcpToolHandler = new McpToolHandler(app)
    app.set('mcpToolHandler', mcpToolHandler)
    if (options.serverInfo) {
      app.set('mcpServerInfo', options.serverInfo)
    }
    if (options.sessionTtlMs !== undefined) {
      app.set('mcpSessionTtlMs', options.sessionTtlMs)
    }
    if (options.maxSessions !== undefined) {
      app.set('mcpMaxSessions', options.maxSessions)
    }

    for (const Tool of options.tools ?? []) {
      mcpToolHandler.register(new Tool(app))
    }

    app.configure(mcpServer)
  }
}
