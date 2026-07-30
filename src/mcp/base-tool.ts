import type { Static, TSchema } from '@feathersjs/typebox'
import type { EmitFunction, McpParams } from '../mcp-server/mcp-server.class.js'
import type { McpApplication } from './app.js'
import { signedUrlToBase64 } from '../utils/signed-url-to-base64.js'

export type ToolResponseType = 'json' | 'image' | 'resource' | 'text'

export type JSONToolResponse<T> = {
  result: T
  type: 'json'
}

export type ImageToolResponse = {
  type: 'image'
  /** Raw base64, with no `data:` URI prefix — that is what MCP's ImageContent expects. */
  data: string
  mimeType: string // e.g., 'image/png'
}

export type TextToolResponse = {
  type: 'text'
  data: string
}

export type ResourceToolResponse = {
  type: 'resource'
  resource: {
    uri: string // e.g., "provisioning://ship/MSC-001/invoice/2024-001.pdf"
    mimeType: string // e.g., 'application/pdf'
    /** Raw base64, with no `data:` URI prefix. Sent to the client as EmbeddedResource `blob`. */
    data: string
  }
}

export type ToolResponse<T> = {
  json?: JSONToolResponse<T>
  image?: ImageToolResponse
  resource?: ResourceToolResponse
  text?: TextToolResponse
}

export abstract class BaseTool<N extends string, I extends TSchema, O extends TSchema> {
  protected app: McpApplication

  abstract readonly name: N
  abstract readonly description: string
  abstract readonly inputSchema: I
  abstract readonly outputSchema: O
  abstract readonly expose?: {
    mcp?: boolean
    openai?: boolean
  }

  constructor(app: McpApplication) {
    this.app = app
  }

  /**
   * `params` is the authenticated Feathers params of the caller (including `params.user`), so a
   * handler can call other services on the user's behalf. `emit` sends progress or log
   * notifications back to the client while the call is still running.
   */
  abstract handler(
    input: Static<I>,
    params: McpParams,
    emit: EmitFunction
  ): Promise<ToolResponse<Static<O>>> | ToolResponse<Static<O>>

  /**
   * Fetches an upload and returns it as an embedded resource.
   *
   * `params` is required, and must be the params the handler was given. Without them the call to
   * `uploads` is an internal one — `params.provider` is undefined — and every authorization hook
   * written the usual way (`if (context.params.provider)`) is skipped, `authenticate()` included.
   * Since the upload id comes from the model, that turned this helper into an IDOR: any caller
   * could name any other user's upload and get its contents back.
   */
  async resourceFromUploadId(
    uploadId: number | undefined,
    uri: string,
    params: McpParams,
    appendOriginalName = true
  ): Promise<ResourceToolResponse | undefined> {
    if (uploadId === undefined) return

    if (!params?.provider) {
      throw new Error(
        'feathers-mcp: resourceFromUploadId needs the params passed to the tool handler, so the ' +
          "uploads service sees an external call and applies the caller's permissions."
      )
    }

    const upload = await this.app.service('uploads').get(uploadId, params)
    if (!upload) {
      throw new Error(`Upload with ID ${uploadId} not found`)
    }

    const fullUri = appendOriginalName ? `${uri}/${upload.originalName}` : uri

    const signedUrl = upload.signedUrl
    if (!signedUrl) return

    const { data, mimeType } = await signedUrlToBase64(signedUrl)

    return {
      type: 'resource',
      resource: {
        uri: fullUri,
        mimeType,
        data
      }
    }
  }

  /**
   * Fetches an upload and returns it as an image content block, or `undefined` if the upload is not
   * an image (`contentType` does not start with `image/`).
   *
   * `params` is required for the same reason as in {@link resourceFromUploadId}: without it the
   * `uploads` call is internal, every `if (context.params.provider)` authorization hook is skipped,
   * and an id that came from the model turns the helper into an IDOR.
   */
  async imageFromUploadId(
    uploadId: number | undefined,
    params: McpParams
  ): Promise<ImageToolResponse | undefined> {
    if (uploadId === undefined) return

    if (!params?.provider) {
      throw new Error(
        'feathers-mcp: imageFromUploadId needs the params passed to the tool handler, so the ' +
          "uploads service sees an external call and applies the caller's permissions."
      )
    }

    const upload = await this.app.service('uploads').get(uploadId, params)
    if (!upload) {
      throw new Error(`Upload with ID ${uploadId} not found`)
    }

    if (!upload.contentType?.startsWith('image/')) return

    const signedUrl = upload.signedUrl
    if (!signedUrl) return

    const { data, mimeType } = await signedUrlToBase64(signedUrl)

    return { type: 'image', data, mimeType }
  }
}
