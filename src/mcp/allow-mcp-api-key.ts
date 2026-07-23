import type { HookContext, NextFunction } from '@feathersjs/feathers'

const BEARER = /^Bearer\s+/i

export interface AllowMcpApiKeyOptions {
  /** Registered authentication strategy to run for this key. Defaults to 'mcpApiKey'. */
  strategy?: string
  /**
   * Property the extracted header value is placed under on the authentication request object.
   * Only matters if `strategy` points at a pre-existing strategy that expects a field other than
   * `apiKey`. Defaults to 'apiKey'.
   */
  field?: string
}

/**
 * Rewrites `params.authentication` so the configured strategy picks up the key from the configured
 * header. External calls only — an internal call already carries whatever authentication it needs.
 */
export default (options: AllowMcpApiKeyOptions = {}) =>
  async (context: HookContext, next: NextFunction) => {
    const { params, app } = context

    if (!params.provider || !params.headers) {
      return next()
    }

    const strategy = options.strategy ?? 'mcpApiKey'
    const field = options.field ?? 'apiKey'
    const configured: string = app.get('authentication')?.[strategy]?.header ?? 'Authorization'
    const headerField = configured.toLowerCase()
    const header = params.headers[headerField]

    if (typeof header === 'string') {
      const apiKey = extractKey(header, headerField)

      if (apiKey) {
        context.params = {
          ...params,
          authentication: {
            strategy,
            [field]: apiKey
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
