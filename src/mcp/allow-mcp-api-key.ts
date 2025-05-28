import { HookContext, NextFunction } from '@feathersjs/feathers';

export default () => async (context: HookContext, next: NextFunction) => {
  const { params, app } = context;

  const headerField = app.get('authentication').mcpApiKey.header.toLowerCase();
  const apiKey = params.headers ? params.headers[headerField]?.substring(7) : null;

  if (apiKey && params.provider) {
    context.params = {
      ...params,
      authentication: {
        strategy: 'mcpApiKey',
        apiKey
      }
    };
  }

  return next();
}