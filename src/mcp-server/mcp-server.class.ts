// For more information about this file see https://dove.feathersjs.com/guides/cli/service.class.html#custom-services
import type { Params, ServiceInterface } from "@feathersjs/feathers";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { randomUUID } from "crypto";
import { ToolResponse } from "../mcp/base-tool.js";
import { isKoaApp, type McpApplication } from "../mcp/app.js";
import { typeboxToZodObject } from "../utils/typebox-to-zod-object.js";

export interface McpServiceOptions {
    app: McpApplication;
}

export interface McpParams extends Params {
    // koaRequest?: KoaRequest;
    // koaResponse?: KoaResponse;
    // req?: ExpressRequest;
    // res?: ExpressResponse;
}

interface EmitOptions {
    progress?: number;
    total?: number;
    level?: "debug" | "info" | "warning" | "error";
    type?: "progress" | "log";
}

const SESSION_ID_HEADER_NAME = "mcp-session-id";
const JSON_RPC = "2.0";

// This is a skeleton for a custom service class. Remove or add the methods you need here
export class McpServerService<ServiceParams extends McpParams = McpParams>
    implements ServiceInterface<any, any, ServiceParams, never>
{
    private server: McpServer;
    private transports: Record<string, StreamableHTTPServerTransport> = {};
    private paramsMap = new Map<string, McpParams>();

    constructor(public options: McpServiceOptions) {
        this.server = new McpServer(
            {
                name: "feathers-mcp-server",
                version: "1.0.0",
            },
            {
                capabilities: {
                    tools: {},
                    resources: {},
                    prompts: {},
                    logging: {},
                },
            }
        );

        this.setupTools();
        this.setupResources();
        this.setupPrompts();
    }

    private setupTools() {
        this.options.app
            .get("mcpToolHandler")
            .getForMcp()
            .forEach((tool: any) => {
                const zodInputSchema = typeboxToZodObject(tool.inputSchema);
                // const zodOutputSchema = typeboxToZodObject(tool.outputSchema)

                console.log("zodInputSchema", zodInputSchema.shape);
                // console.log('zodOutputSchema', zodOutputSchema.shape)
                this.server.tool(
                    tool.name,
                    tool.description,
                    zodInputSchema.shape,
                    async (args, extra) => {
                        console.log("Tool called:", tool.name, args);
                        const sessionId = extra.sessionId;
                        if (!sessionId) {
                            throw new Error("Session ID is required");
                        }

                        const feathersParams = this.paramsMap.get(sessionId);
                        if (!feathersParams) {
                            throw new Error("Params not found for session ID");
                        }

                        const transport = this.transports[sessionId];

                        const progressToken = extra._meta?.progressToken;
                        const emit = this.getEmitFunction(
                            transport,
                            progressToken
                        );

                        try {
                            const result = await tool.handler(
                                args,
                                feathersParams,
                                emit
                            );
                            console.log("Tool result:", tool.name, result);
                            const res = this.transformToMcpResponse(result);
                            console.log("Transformed result:", res);
                            return res;
                        } catch (error) {
                            console.log(
                                "Error in tool handler:",
                                tool.name,
                                error
                            );
                            const message =
                                error instanceof Error
                                    ? error.message
                                    : String(error);
                            return {
                                content: [
                                    {
                                        type: "text",
                                        text: message,
                                    },
                                ],
                                isError: true,
                            };
                        }
                    }
                );
            });
    }

    private setupResources() {}

    private setupPrompts() {}

    private cleanupSessions() {
        Object.entries(this.transports).forEach(([sessionId, transport]) => {
            try {
                transport.close?.();
            } catch (error) {
                console.error(
                    `Error closing transport for session ${sessionId}:`,
                    error
                );
            }
        });
    }

    private cleanupSession(sessionId: string | undefined) {
        if (!sessionId) return;
        console.log(`Cleaning up session: ${sessionId}`);
        delete this.transports[sessionId];
        this.paramsMap.delete(sessionId);
    }

    async create(data: any, params?: ServiceParams): Promise<any> {
        const sessionId = this.getSessionId(params);

        console.log("post request received");
        console.log("data: ", data);

        // Almacenar params para esta sesión
        if (sessionId && params) {
            this.paramsMap.set(sessionId, params);
        }
        const isKoa = isKoaApp(this.options.app);

        const req = isKoa ? (params as any)?.koaRequest : (params as any)?.req;
        const res = isKoa ? (params as any)?.koaResponse : (params as any)?.res;
        if (!req || !res) {
            throw new Error("Missing request/response objects");
        }

        let transport: StreamableHTTPServerTransport;

        try {
            // ✅ 1. Initialize (new transport)
            if (!sessionId && data.method === "initialize") {
                console.log("Creating new transport for session:");
                const transport = this.setupTransport();

                await this.server.connect(transport);
                await transport.handleRequest(req as any, res as any, data);

                // session ID will only be available (if in not Stateless-Mode)
                // after handling the first request
                const sessionId = transport.sessionId;
                if (sessionId) {
                    this.transports[sessionId] = transport;
                    // Almacenar params para la nueva sesión
                    if (params) {
                        this.paramsMap.set(sessionId, params);
                    }
                }

                return;
            }

            // ✅ 2. Handle notifications
            if (data.method?.startsWith("notifications/")) {
                console.log("Handling notification:", data.method);

                // For notifications, we don't need to send a response
                // Just handle the notification if we have a transport

                if (sessionId && this.transports[sessionId]) {
                    transport = this.transports[sessionId];

                    if (transport) {
                        try {
                            await transport.handleRequest(
                                req as any,
                                res as any,
                                data
                            );
                        } catch (error) {
                            console.error(
                                `Error handling notification for session ${sessionId}:`,
                                error
                            );
                        }
                    }
                    return;
                } else {
                    console.log(
                        `No transport found for session ${sessionId}, ignoring notification`
                    );
                    return;
                }
            }

            // ✅ 3. Handle regular methods with existing session
            if (sessionId && this.transports[sessionId]) {
                console.log(
                    "Reusing existing transport for session:",
                    sessionId
                );
                transport = this.transports[sessionId];
                try {
                    await transport.handleRequest(req as any, res as any, data);
                } catch (error) {
                    console.error(
                        `Error handling request for session ${sessionId}:`,
                        error
                    );
                    // Clean up broken session
                    this.cleanupSession(sessionId);
                    throw error;
                }
                return;
            }

            // ✅ 4. Handle unknown methods or missing sessions
            console.error("Unknown method or missing session:", {
                method: data.method,
                sessionId,
                hasTransport: sessionId ? !!this.transports[sessionId] : false,
            });

            // Return proper JSON-RPC error response
            return {
                jsonrpc: JSON_RPC,
                id: data.id || null,
                error: {
                    code: -32601,
                    message: `Method not found: ${data.method}`,
                    data: {
                        method: data.method,
                        sessionId: sessionId || "missing",
                    },
                },
            };
        } catch (error) {
            console.error("Error handling MCP request:", error);
            // Return proper JSON-RPC error response instead of throwing
            return {
                jsonrpc: JSON_RPC,
                id: data.id || null,
                error: {
                    code: -32603,
                    message: "Internal error",
                    data:
                        error instanceof Error ? error.message : String(error),
                },
            };
        }
    }

    async get(id: string, params: ServiceParams): Promise<any> {
        const sessionId = this.getSessionId(params);
        if (!sessionId || !this.transports[sessionId]) {
            return {
                jsonrpc: JSON_RPC,
                error: {
                    code: -32000,
                    message: "Invalid or missing session ID",
                },
                id: null,
            };
        }

        const isKoa = isKoaApp(this.options.app);

        const req = isKoa ? (params as any)?.koaRequest : (params as any)?.req;
        const res = isKoa ? (params as any)?.koaResponse : (params as any)?.res;
        if (!req || !res) {
            throw new Error("Missing request/response objects");
        }

        const transport = this.transports[sessionId];
        await transport.handleRequest(req as any, res as any);
        return;
    }

    private getSessionId(
        params: ServiceParams | undefined
    ): string | undefined {
        return params?.headers?.[SESSION_ID_HEADER_NAME] as string | undefined;
    }

    getEmitFunction(
        transport: StreamableHTTPServerTransport,
        progressToken?: string | number
    ) {
        return (message: string, options?: EmitOptions | number) => {
            if (!transport) {
                console.warn("Attempted to emit message but transport is null");
                return;
            }
            // Backward compatibility: if options is a number, it's progress
            const opts =
                typeof options === "number"
                    ? { progress: options }
                    : options || {};

            const { progress, total = 100, level = "info", type } = opts;

            // Decide notification type
            const shouldUseProgress =
                progressToken &&
                (type === "progress" ||
                    (type !== "log" && progress !== undefined));

            if (shouldUseProgress) {
                transport.send({
                    jsonrpc: "2.0",
                    method: "notifications/progress",
                    params: {
                        progressToken,
                        progress: progress !== undefined ? progress : 0,
                        total,
                        message,
                    },
                });
            } else {
                transport.send({
                    jsonrpc: "2.0",
                    method: "notifications/log",
                    params: {
                        level,
                        message,
                    },
                });
            }
        };
    }

    private setupTransport() {
        const transport = new StreamableHTTPServerTransport({
            sessionIdGenerator: () => randomUUID(),
            // for stateless mode:
            // sessionIdGenerator: () => undefined
        });
        transport.onclose = () => {
            console.log(
                `SSE transport closed for session: ${transport.sessionId}`
            );
            this.cleanupSession(transport.sessionId);
        };
        transport.onerror = (error) => {
            console.error(
                `Transport error for session ${transport.sessionId}:`,
                error
            );
            this.cleanupSession(transport.sessionId);
        };
        transport.onmessage = (message) => {
            console.log(
                `Received message for session ${transport.sessionId}:`,
                message
            );
        };
        return transport;
    }

    teardown(app: McpApplication, path: string): Promise<void> {
        console.log("🔥 Destroying MCP service...");

        this.cleanupSessions();

        this.transports = {};
        this.paramsMap.clear();
        return Promise.resolve();
    }

    private transformToMcpResponse(result: ToolResponse<any>) {
        console.log("Transform input:", typeof result, result);

        const { json, image, resource, text } = result;

        // Transform simple result to MCP format
        const mcpResponse = {
            content: [
                ...(json
                    ? [{ type: "text", text: JSON.stringify(json.result) }]
                    : []),
                ...(text ? [{ type: "text", text: text.data }] : []),
                ...(image
                    ? [
                          {
                              type: "image",
                              image: {
                                  data: image.data,
                                  mimeType: image.mimeType,
                              },
                          },
                      ]
                    : []),
                ...(resource
                    ? [
                          {
                              type: "resource",
                              resource: {
                                  uri: resource.resource.uri,
                                  mimeType: resource.resource.mimeType,
                                  data: resource.resource.data,
                              },
                          },
                      ]
                    : []),
            ],
        };
        console.log(
            "Transformed to MCP:",
            JSON.stringify(mcpResponse, null, 2)
        );

        return mcpResponse as any;
    }
}

export const getOptions = (app: McpApplication) => {
    return { app, id: "name" };
};
