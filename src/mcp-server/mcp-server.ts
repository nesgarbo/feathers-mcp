// For more information about this file see https://dove.feathersjs.com/guides/cli/service.html
import { authenticate } from "@feathersjs/authentication";
import allowMcpApiKey from "../mcp/allow-mcp-api-key.js";
import { McpApplication, isKoaApplication } from "../mcp/app.js";
import { Application } from "@feathersjs/feathers";
import { McpServerService, getOptions } from "./mcp-server.class.js";
import { mcpServerMethods, mcpServerPath } from "./mcp-server.shared.js";

export * from "./mcp-server.class.js";

// A configure function that registers the service and its hooks via `app.configure`
export const mcpServer = (app: McpApplication) => {
  const service = new McpServerService(getOptions(app));

  const serviceOptions = {
    methods: mcpServerMethods,
    events: [],
  };

  const a = isKoaApplication(app);
  console.log("isKoaApplication", a);
  if (a) {
    Object.assign(serviceOptions, {
      koa: {
        before: [
          async (ctx: any, next: any) => {
            // Set the feathers request and response objects
            ctx.feathers!.koaRequest = ctx.req;
            ctx.feathers!.koaResponse = ctx.res;
            await next();
          },
        ],
      },
    });
  } else {
    Object.assign(serviceOptions, {
      express: {
        before: [
          (req: any, res: any, next: any) => {
            // Puedes añadir cualquier cabecera o lógica aquí si quieres
            req.feathers.expressRequest = req;
            req.feathers.expressResponse = res;
            next();
          },
        ],
      },
    });
  }
  ;(app as Application).use(mcpServerPath, service, serviceOptions)
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