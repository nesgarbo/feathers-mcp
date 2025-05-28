import type { BaseTool } from './base-tool.js'
import type { McpToolBase } from './mcp-tool-types.js'

export type InferMcpToolType<T extends BaseTool<any, any, any>> =
  T extends BaseTool<infer N, infer I, infer O> ? McpToolBase<N, I, O> : never