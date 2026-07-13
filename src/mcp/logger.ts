const enabled = /(^|,)(\*|feathers-mcp)(,|$)/.test(process.env.DEBUG ?? '')

/**
 * MCP sessions are painful to debug without a message trace, but a library has no business
 * writing to a host app's stdout by default. Opt in with `DEBUG=feathers-mcp`.
 */
export const debug = (...args: unknown[]): void => {
  if (enabled) {
    console.log('[feathers-mcp]', ...args)
  }
}

export const warn = (...args: unknown[]): void => {
  console.warn('[feathers-mcp]', ...args)
}
