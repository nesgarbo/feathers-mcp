import type { HookContext, NextFunction } from '@feathersjs/feathers'

const BEARER = /^Bearer\s+/i

/**
 * Rewrites `params.authentication` so the `mcpApiKey` strategy picks up the key from the configured
 * header. External calls only — an internal call already carries whatever authentication it needs.
 */
export default () => async (context: HookContext, next: NextFunction) => {
  const { params, app } = context

  if (!params.provider || !params.headers) {
    return next()
  }

  const configured: string = app.get('authentication')?.mcpApiKey?.header ?? 'Authorization'
  const headerField = configured.toLowerCase()
  const header = params.headers[headerField]

  if (typeof header === 'string') {
    const apiKey = extractKey(header, headerField)

    if (apiKey) {
      context.params = {
        ...params,
        authentication: {
          strategy: 'mcpApiKey',
          apiKey
        }
      }
    }
  }

  return next()
}

/**
 * `Authorization` carries a scheme, so the key has to be unwrapped from `Bearer <key>` — but only
 * an actual `Bearer ` prefix, never a blind `.substring(7)`, which used to turn any other scheme
 * into a garbage key seven characters short.
 *
 * A dedicated header like `x-api-key` carries the key bare. Requiring `Bearer ` there made the
 * `authentication.mcpApiKey.header` option a trap: configure anything but `Authorization` and every
 * request 401s.
 */
const extractKey = (header: string, headerField: string): string | undefined => {
  if (headerField === 'authorization') {
    return BEARER.test(header) ? header.replace(BEARER, '').trim() || undefined : undefined
  }

  // Tolerate a Bearer prefix on a custom header too — some clients add one regardless.
  return (BEARER.test(header) ? header.replace(BEARER, '') : header).trim() || undefined
}
