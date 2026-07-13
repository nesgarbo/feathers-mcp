// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from '@feathersjs/authentication'
import allowMcpApiKey from '../mcp/allow-mcp-api-key.js'
import { isKoaApp, type McpApplication } from '../mcp/app.js'
import { McpServerService, getOptions } from './mcp-server.class.js'
import { mcpServerMethods, mcpServerPath } from './mcp-server.shared.js'

export * from './mcp-server.class.js'

/**
 * The MCP transport writes to the raw Node response itself, so two things have to happen: the raw
 * request/response must reach the service through `params`, and the framework must be told to keep
 * its hands off the socket afterwards.
 */
function getTransportMiddleware(app: McpApplication) {
  if (isKoaApp(app)) {
    return {
      koa: {
        before: [
          async (ctx: any, next: any) => {
            ctx.feathers ||= {}
            ctx.feathers.koaRequest = ctx.req
            ctx.feathers.koaResponse = ctx.res

            await next()

            // Only now hand the socket over. Setting `ctx.respond = false` up front would also gag
            // Koa's error handler, so an auth failure — which happens before the transport ever
            // sees the request — would hang the client instead of returning 401.
            if (ctx.res.headersSent) {
              ctx.respond = false
            }
          }
        ]
      }
    }
  }

  return {
    express: {
      before: [
        (req: any, _res: any, next: any) => {
          req.feathers ||= {}
          req.feathers.expressRequest = req
          req.feathers.expressResponse = _res
          next()
        }
      ],
      // Express has no `ctx.respond = false`. Once the transport has written the response, stop the
      // chain so Feathers' REST formatter cannot set headers on an already-sent response.
      after: [
        (_req: any, res: any, next: any) => {
          if (res.headersSent) return
          next()
        }
      ]
    }
  }
}

// A configure function that registers the service and its hooks via `app.configure`
export const mcpServer = (app: McpApplication) => {
  const service = new McpServerService(getOptions(app))

  app.use(mcpServerPath, service, {
    methods: mcpServerMethods,
    events: [],
    ...getTransportMiddleware(app)
  })

  app.service(mcpServerPath).hooks({
    around: {
      all: [allowMcpApiKey(), authenticate('mcpApiKey')]
    }
  })
}
