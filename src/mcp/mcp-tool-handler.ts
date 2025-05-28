import { Type } from '@feathersjs/typebox'
import { McpApplication } from './app.js'
import { BaseTool } from './base-tool.js'
import { McpToolMap } from './mcp-tool-types.js'

export class McpToolHandler {
  app: McpApplication

  private tools = new Map<keyof McpToolMap, BaseTool<any, any, any>>()

  constructor(app: McpApplication) {
    this.app = app
  }

  register(tool: BaseTool<any, any, any>) {
    console.log('Registering tool:', tool.name)
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

  getToolcallSchema() {
    const entries = this.getForMcp().map((tool) =>
      Type.Object({
        id: Type.Number(),
        name: Type.Literal(tool.name),
        parameters: tool.inputSchema,
        // outputSchema: tool.outputSchema
      })
    )

    return Type.Union(entries, { $id: 'McpData' })
  }

  buildToolsSchema() {
    const schemas = this.getForMcp().map((tool) =>
      Type.Object({
        name: Type.Literal(tool.name),
        description: Type.String(),
        parameters: tool.inputSchema,
        outputSchema: tool.outputSchema,
      })
    )
  
    return Type.Array(Type.Union(schemas), { $id: 'Tools' })
  }

  
}