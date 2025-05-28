"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.rest = exports.formatter = void 0;
const koa_compose_1 = __importDefault(require("koa-compose"));
const transport_commons_1 = require("@feathersjs/transport-commons");
const commons_1 = require("@feathersjs/commons");
const feathers_1 = require("@feathersjs/feathers");
const errors_1 = require("@feathersjs/errors");
const authentication_1 = require("./authentication");
const debug = (0, commons_1.createDebug)('@feathersjs/koa/rest');
const serviceMiddleware = () => {
    return async (ctx, next) => {
        const { query, headers, path, body: data, method: httpMethod } = ctx.request;
        const methodOverride = ctx.request.headers[transport_commons_1.http.METHOD_HEADER];
        // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
        const { service, params: { __id: id = null, ...route } = {} } = ctx.lookup;
        const method = transport_commons_1.http.getServiceMethod(httpMethod, id, methodOverride);
        const { methods } = (0, feathers_1.getServiceOptions)(service);
        debug(`Found service for path ${path}, attempting to run '${method}' service method`);
        if (!methods.includes(method) || feathers_1.defaultServiceMethods.includes(methodOverride)) {
            const error = new errors_1.MethodNotAllowed(`Method \`${method}\` is not supported by this endpoint.`);
            ctx.response.status = error.code;
            throw error;
        }
        const createArguments = transport_commons_1.http.argumentsFor[method] || transport_commons_1.http.argumentsFor.default;
        const params = { query, headers, route, ...ctx.feathers };
        const args = createArguments({ id, data, params });
        const contextBase = (0, feathers_1.createContext)(service, method, { http: {} });
        ctx.hook = contextBase;
        const context = await service[method](...args, contextBase);
        ctx.hook = context;
        const response = transport_commons_1.http.getResponse(context);
        ctx.status = response.status;
        ctx.set(response.headers);
        ctx.body = response.body;
        return next();
    };
};
const servicesMiddleware = () => {
    return async (ctx, next) => {
        const app = ctx.app;
        const lookup = app.lookup(ctx.request.path);
        if (!lookup) {
            return next();
        }
        ctx.lookup = lookup;
        const options = (0, feathers_1.getServiceOptions)(lookup.service);
        const middleware = options.koa.composed;
        return middleware(ctx, next);
    };
};
// eslint-disable-next-line @typescript-eslint/no-empty-function
const formatter = (_ctx, _next) => { };
exports.formatter = formatter;
const rest = (options) => {
    options = typeof options === 'function' ? { formatter: options } : options || {};
    const formatterMiddleware = options.formatter || exports.formatter;
    const authenticationOptions = options.authentication;
    return (app) => {
        app.use((0, authentication_1.parseAuthentication)(authenticationOptions));
        app.use(servicesMiddleware());
        app.mixins.push((_service, _path, options) => {
            const { koa: { before = [], after = [] } = {} } = options;
            const middlewares = [].concat(before, serviceMiddleware(), after, formatterMiddleware);
            const middleware = (0, koa_compose_1.default)(middlewares);
            options.koa || (options.koa = {});
            options.koa.composed = middleware;
        });
    };
};
exports.rest = rest;
//# sourceMappingURL=rest.js.map