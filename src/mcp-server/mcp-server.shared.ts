// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
export const mcpServerPath = 'mcp-server'

// POST carries every JSON-RPC message, GET opens the standalone SSE stream, DELETE terminates the
// session — the three verbs the MCP Streamable HTTP transport uses.
//
// `find` is what an id-less GET maps to in Feathers, and MCP always GETs the bare endpoint, so the
// SSE stream arrives there rather than at `get`. `get` is kept so `GET /mcp-server/:id` also works.
export const mcpServerMethods = ['create', 'find', 'get', 'remove'] as const
