import { Params, ServiceInterface, HookContext, NextFunction } from '@feathersjs/feathers';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Application } from '@feathersjs/koa';
import { Application as Application$1 } from '@feathersjs/express';
import { TSchema, Static } from '@feathersjs/typebox';
import * as _sinclair_typebox from '@sinclair/typebox';
import { AuthenticationBaseStrategy, AuthenticationRequest, AuthenticationParams, AuthenticationResult } from '@feathersjs/authentication';

type McpApplication = Application | Application$1;

interface McpServiceOptions {
    app: McpApplication;
}
interface McpParams extends Params {
}
interface EmitOptions {
    progress?: number;
    total?: number;
    level?: "debug" | "info" | "warning" | "error";
    type?: "progress" | "log";
}
declare class McpServerService<ServiceParams extends McpParams = McpParams> implements ServiceInterface<any, any, ServiceParams, never> {
    options: McpServiceOptions;
    private server;
    private transports;
    private paramsMap;
    constructor(options: McpServiceOptions);
    private setupTools;
    private setupResources;
    private setupPrompts;
    private cleanupSessions;
    private cleanupSession;
    create(data: any, params?: ServiceParams): Promise<any>;
    get(id: string, params: ServiceParams): Promise<any>;
    private getSessionId;
    getEmitFunction(transport: StreamableHTTPServerTransport, progressToken?: string | number): (message: string, options?: EmitOptions | number) => void;
    private setupTransport;
    teardown(app: McpApplication, path: string): Promise<void>;
    private transformToMcpResponse;
}

type JSONToolResponse<T> = {
    result: T;
    type: 'json';
};
type ImageToolResponse = {
    type: 'image';
    data: string;
    mimeType: string;
};
type TextToolResponse = {
    type: 'text';
    data: string;
};
type ResourceToolResponse = {
    type: 'resource';
    resource: {
        uri: string;
        mimeType: string;
        data: string;
    };
};
type ToolResponse<T> = {
    json?: JSONToolResponse<T>;
    image?: ImageToolResponse;
    resource?: ResourceToolResponse;
    text?: TextToolResponse;
};
declare abstract class BaseTool<N extends string, I extends TSchema, O extends TSchema> {
    protected app: McpApplication;
    abstract readonly name: N;
    abstract readonly description: string;
    abstract readonly inputSchema: I;
    abstract readonly outputSchema: O;
    abstract readonly expose?: {
        mcp?: boolean;
        openai?: boolean;
    };
    constructor(app: McpApplication);
    abstract handler(input: Static<I>, context: McpParams, emit: (messsage: string, progress?: number) => void): Promise<ToolResponse<Static<O>>> | ToolResponse<Static<O>>;
    resourceFromUploadId(uploadId: number | undefined, uri: string, appendOriginalName?: boolean): Promise<ResourceToolResponse | undefined>;
}

interface McpToolBase<Name extends string, InputSchema extends TSchema, OutputSchema extends TSchema> {
    name: Name;
    inputSchema: InputSchema;
    outputSchema: OutputSchema;
    handler: (input: Static<InputSchema>, app: McpApplication, params?: Params) => Promise<Static<OutputSchema>>;
}
interface McpToolMap {
}

type InferMcpToolType<T extends BaseTool<any, any, any>> = T extends BaseTool<infer N, infer I, infer O> ? McpToolBase<N, I, O> : never;

declare class McpToolHandler {
    app: McpApplication;
    private tools;
    constructor(app: McpApplication);
    register(tool: BaseTool<any, any, any>): void;
    getAll(): BaseTool<any, any, any>[];
    getByName(name: keyof McpToolMap): BaseTool<any, any, any> | undefined;
    getForMcp(): BaseTool<any, any, any>[];
    getForOpenAi(): BaseTool<any, any, any>[];
    getToolcallSchema(): _sinclair_typebox.TUnion<_sinclair_typebox.TObject<{
        id: _sinclair_typebox.TNumber;
        name: _sinclair_typebox.TLiteral<any>;
        parameters: any;
    }>[]>;
    buildToolsSchema(): _sinclair_typebox.TArray<_sinclair_typebox.TUnion<_sinclair_typebox.TObject<{
        name: _sinclair_typebox.TLiteral<any>;
        description: _sinclair_typebox.TString<string>;
        parameters: any;
        outputSchema: any;
    }>[]>>;
}

declare const _default: () => (context: HookContext, next: NextFunction) => Promise<any>;

declare class McpApiKeyStrategy extends AuthenticationBaseStrategy {
    authenticate(authenticationRequest: AuthenticationRequest, params: AuthenticationParams): Promise<AuthenticationResult>;
}

declare const mcpServerPath = "mcp-server";

type ToolClass = new (app: McpApplication) => BaseTool<any, any, any>;
interface FeathersMcpOptions {
    tools?: ToolClass[];
}
declare function feathersMcp(options?: FeathersMcpOptions): (app: McpApplication) => void;

export { BaseTool, type FeathersMcpOptions, type InferMcpToolType, McpApiKeyStrategy, type McpParams, McpServerService, McpToolHandler, type ToolClass, type ToolResponse, _default as allowMcpApiKey, feathersMcp, mcpServerPath };
