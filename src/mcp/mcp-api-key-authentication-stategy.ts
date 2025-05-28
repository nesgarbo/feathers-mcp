import type {
  AuthenticationParams,
  AuthenticationRequest,
  AuthenticationResult
} from '@feathersjs/authentication'
import { AuthenticationBaseStrategy } from '@feathersjs/authentication'
import { McpApplication } from './app.js'
import { Forbidden } from '@feathersjs/errors'

export class McpApiKeyStrategy extends AuthenticationBaseStrategy {
  async authenticate(
    authenticationRequest: AuthenticationRequest,
    params: AuthenticationParams
  ): Promise<AuthenticationResult> {
    const { apiKey } = authenticationRequest

    if (!apiKey) {
      throw new Forbidden('API key is missing')
    }

    const app = this.app as McpApplication

    const result = await app
      .service('mcp-api-keys')
      .get(apiKey)
      .catch(() => undefined)

    if (!result || !result.isActive) {
      throw new Forbidden('Invalid API key')
    }

    const user = await app
      .service('users')
      .get(result.userId)
      .catch(() => undefined)

    if (!user) {
      throw new Forbidden('User not found')
    }

    return {
      authentication: { strategy: 'mcpApiKey' },
      user
    }
  }
}