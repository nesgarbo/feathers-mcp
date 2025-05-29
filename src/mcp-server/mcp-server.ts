// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from "@feathersjs/authentication";
import allowMcpApiKey from "../mcp/allow-mcp-api-key.js";
import { McpApplication, isKoaApp } from "../mcp/app.js";
import { Application } from "@feathersjs/feathers";
import { McpServerService, getOptions } from "./mcp-server.class.js";
import { mcpServerMethods, mcpServerPath } from "./mcp-server.shared.js";

export * from "./mcp-server.class.js";

function getTransportMiddleware(app: McpApplication) {
  if (isKoaApp(app)) {
    return {
      koa: {
        before: [
          async (ctx: any, next: any) => {
            ctx.feathers ||= {};
            ctx.feathers.koaRequest = ctx.req;
            ctx.feathers.koaResponse = ctx.res;
            await next();
          }
        ]
      }
    };
  }

  return {
    express: {
      before: [
        (req: any, res: any, next: any) => {
          req.feathers ||= {};
          req.feathers.expressRequest = req;
          req.feathers.expressResponse = res;
          next();
        }
      ]
    }
  };
}

// A configure function that registers the service and its hooks via `app.configure`
export const mcpServer = (app: McpApplication) => {
  const service = new McpServerService(getOptions(app));

  const serviceOptions = {
    methods: mcpServerMethods,
    events: [],
    ...getTransportMiddleware(app)
  };

  (app as Application).use(mcpServerPath, service, serviceOptions)
  // Initialize hooks
  app.service(mcpServerPath).hooks({
    around: {
      all: [allowMcpApiKey(), authenticate("mcpApiKey")],
    },
    before: {
      all: [],
      create: [
        (context: any) => {
          console.log("context.data", context.data);
        },
      ],
    },
    after: {
      all: [],
    },
    error: {
      all: [],
    },
  });
};