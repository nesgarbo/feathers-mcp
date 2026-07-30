// For more information about this file see https://dove.feathersjs.com/guides/cli/service.shared.html
export const mcpServerPath = 'mcp-server'

// POST carries every JSON-RPC message in both protocol eras. GET (the 2025-era standalone SSE
// stream) and DELETE (2025-era session termination) are session operations that stateless serving
// answers `405` — still routed, so the refusal is the SDK's own rather than a Feathers 404.
//
// `find` is what an id-less GET maps to in Feathers, and MCP always GETs the bare endpoint, so the
// stream request arrives there rather than at `get`. `get` is kept so `GET /mcp-server/:id` works.
export const mcpServerMethods = ['create', 'find', 'get', 'remove'] as const
