import type { Application, Params } from '@feathersjs/feathers'
import type { Application as KoaApplication } from '@feathersjs/koa'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Any Feathers app, Koa- or Express-backed.
 *
 * Deliberately *not* `KoaApplication | ExpressApplication`: TypeScript cannot call `.use()` on that
 * union — the two overload sets are mutually incompatible — so every call site, in this library and
 * in host apps alike, was forced to cast to `any`. The library only needs the Feathers surface.
 */
export type McpApplication = Application<any, any>

export function isKoaApp(app: McpApplication): app is McpApplication & KoaApplication {
  return 'context' in app
}

export interface RawHttp {
  req: IncomingMessage
  res: ServerResponse<IncomingMessage>
}

/**
 * The MCP transport needs the raw Node request/response, which Feathers does not expose on
 * `params` by default. The transport middleware in `mcp-server.ts` stashes them there under
 * transport-specific keys; this reads them back.
 */
export function getRawHttp(app: McpApplication, params?: Params): RawHttp {
  const koa = isKoaApp(app)
  const req = koa ? params?.koaRequest : params?.expressRequest
  const res = koa ? params?.koaResponse : params?.expressResponse

  if (!req || !res) {
    throw new Error(
      'feathers-mcp: missing raw request/response on params. The mcp-server service must be ' +
        'registered through `feathersMcp()` so its transport middleware runs.'
    )
  }

  return { req, res }
}

declare module '@feathersjs/feathers' {
  interface Params {
    koaRequest?: IncomingMessage
    koaResponse?: ServerResponse<IncomingMessage>
    expressRequest?: IncomingMessage
    expressResponse?: ServerResponse<IncomingMessage>
  }
}
