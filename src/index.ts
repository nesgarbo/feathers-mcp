import { McpParams } from "./mcp-server/mcp-server.class.js";
import { mcpServer } from "./mcp-server/mcp-server.js";
import { McpApplication } from "./mcp/app.js";
import { BaseTool, ToolResponse } from "./mcp/base-tool.js";
import { InferMcpToolType } from "./mcp/infer-mcp-tool-type.js";
import { McpToolHandler } from "./mcp/mcp-tool-handler.js";
import allowMcpApiKey from "./mcp/allow-mcp-api-key.js";
import { McpApiKeyStrategy } from "./mcp/mcp-api-key-authentication-stategy.js";
import { McpServerService } from './mcp-server/mcp-server.class.js';
import { mcpServerPath } from './mcp-server/mcp-server.shared.js';

type ToolClass = new (app: McpApplication) => BaseTool<any, any, any>;

interface FeathersMcpOptions {
  tools?: ToolClass[];
}

function feathersMcp(options: FeathersMcpOptions = {}) {
  return (app: McpApplication) => {
    const mcpToolHandler = new McpToolHandler(app);
    app.set("mcpToolHandler", mcpToolHandler);

    options.tools?.forEach((Tool) => {
      mcpToolHandler.register(new Tool(app));
    });

    app.configure(mcpServer);
  };
}

export {
  BaseTool,
  feathersMcp,
  FeathersMcpOptions,
  InferMcpToolType,
  McpParams,
  ToolClass,
  ToolResponse,
  allowMcpApiKey,
  McpApiKeyStrategy,
  McpToolHandler,
  McpServerService,
  mcpServerPath
};
