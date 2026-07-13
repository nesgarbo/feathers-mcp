import type {
  AuthenticationParams,
  AuthenticationRequest,
  AuthenticationResult
} from '@feathersjs/authentication'
import { AuthenticationBaseStrategy } from '@feathersjs/authentication'
import { NotFound } from '@feathersjs/errors'
import { NotAuthenticated } from '@feathersjs/errors'
import type { McpApplication } from './app.js'

export interface McpApiKeyStrategyOptions {
  /** Service holding the API keys, keyed by the key itself. Defaults to `mcp-api-keys`. */
  service?: string
  /** Field on the key record pointing at its owner. Defaults to `userId`. */
  userIdField?: string
  /** Field on the key record that must be true. Defaults to `isActive`. */
  activeField?: string
}

export class McpApiKeyStrategy extends AuthenticationBaseStrategy {
  constructor(private readonly strategyOptions: McpApiKeyStrategyOptions = {}) {
    super()
  }

  async authenticate(
    authenticationRequest: AuthenticationRequest,
    _params: AuthenticationParams
  ): Promise<AuthenticationResult> {
    const { apiKey } = authenticationRequest

    if (!apiKey) {
      throw new NotAuthenticated('API key is missing')
    }

    const app = this.app as McpApplication
    const {
      service = 'mcp-api-keys',
      userIdField = 'userId',
      activeField = 'isActive'
    } = this.strategyOptions

    // Only a missing record means "bad key". Swallowing every error — as `.catch(() => undefined)`
    // did — reports a database outage to the client as an invalid API key, and hides the outage
    // from whoever has to fix it.
    const record = await app
      .service(service)
      .get(apiKey)
      .catch((error: unknown) => {
        if (error instanceof NotFound) return undefined
        throw error
      })

    if (!record || record[activeField] !== true) {
      throw new NotAuthenticated('Invalid API key')
    }

    const entityService = app.get('authentication')?.service ?? 'users'
    const user = await app
      .service(entityService)
      .get(record[userIdField])
      .catch((error: unknown) => {
        if (error instanceof NotFound) return undefined
        throw error
      })

    if (!user) {
      throw new NotAuthenticated('Invalid API key')
    }

    return {
      authentication: { strategy: 'mcpApiKey' },
      user
    }
  }
}
