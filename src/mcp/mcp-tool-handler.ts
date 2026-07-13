import { Type } from '@feathersjs/typebox'
import type { McpApplication } from './app.js'
import type { BaseTool } from './base-tool.js'
import type { McpToolMap } from './mcp-tool-types.js'
import { debug } from './logger.js'
import { typeboxToZodObject } from '../utils/typebox-to-zod-object.js'

export class McpToolHandler {
  app: McpApplication

  private tools = new Map<keyof McpToolMap, BaseTool<any, any, any>>()

  constructor(app: McpApplication) {
    this.app = app
  }

  register(tool: BaseTool<any, any, any>) {
    // Silently overwriting would leave the shadowed tool registered-but-unreachable, and the only
    // symptom would be an MCP client calling one tool and getting another's behaviour.
    if (this.tools.has(tool.name as keyof McpToolMap)) {
      throw new Error(`feathers-mcp: a tool named '${tool.name}' is already registered`)
    }

    // Convert now, at boot, so a malformed schema fails here with the tool's name on it rather than
    // as a 500 on the first client's `initialize`, which is where it used to surface.
    if (tool.expose?.mcp !== false) {
      try {
        typeboxToZodObject(tool.inputSchema)
      } catch (error) {
        throw new Error(
          `feathers-mcp: tool '${tool.name}' has an unusable input schema — ` +
            (error instanceof Error ? error.message : String(error)),
          { cause: error }
        )
      }
    }

    debug('registering tool:', tool.name)
    this.tools.set(tool.name as keyof McpToolMap, tool)
  }

  getAll() {
    return Array.from(this.tools.values())
  }

  getByName(name: keyof McpToolMap) {
    return this.tools.get(name)
  }

  getForMcp() {
    return this.getAll().filter((t) => t.expose?.mcp !== false)
  }

  getForOpenAi() {
    return this.getAll().filter((t) => t.expose?.openai !== false)
  }

  /**
   * Schemas for host apps doing OpenAI-style function calling. These filter on `expose.openai` —
   * they previously filtered on `expose.mcp`, which made `expose.openai` do nothing at all and
   * meant an MCP-only tool showed up in the OpenAI schema (and vice versa).
   */
  getToolcallSchema() {
    const entries = this.getForOpenAi().map((tool) =>
      Type.Object({
        id: Type.Number(),
        name: Type.Literal(tool.name),
        parameters: tool.inputSchema
      })
    )

    return Type.Union(entries, { $id: 'McpData' })
  }

  buildToolsSchema() {
    const schemas = this.getForOpenAi().map((tool) =>
      Type.Object({
        name: Type.Literal(tool.name),
        description: Type.String(),
        parameters: tool.inputSchema,
        outputSchema: tool.outputSchema
      })
    )

    return Type.Array(Type.Union(schemas), { $id: 'Tools' })
  }
}
