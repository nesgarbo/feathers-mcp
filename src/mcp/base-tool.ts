import type { Static, TSchema } from '@feathersjs/typebox'
import { McpParams } from '../mcp-server/mcp-server.class.js'
import { McpApplication } from './app.js'
import { signedUrlToBase64 } from '../utils/signed-url-to-base64.js'

export type ToolResponseType = 'json' | 'image' | 'resource' | 'text'

export type JSONToolResponse<T> = {
  result: T
  type: 'json'
}

export type ImageToolResponse = {
  type: 'image'
  data: string // Base64 encoded image
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
    data: string // Base64 encoded data
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

  abstract handler(
    input: Static<I>,
    context: McpParams,
    emit: (messsage: string, progress?: number) => void
  ): Promise<ToolResponse<Static<O>>> | ToolResponse<Static<O>>

  async resourceFromUploadId(uploadId: number | undefined, uri: string, appendOriginalName = true): Promise<ResourceToolResponse | undefined> {
    if (uploadId === undefined) return

    const upload = await this.app.service('uploads').get(uploadId)
    if (!upload) {
      throw new Error(`Upload with ID ${uploadId} not found`)
    }

    const fullUri = appendOriginalName ? `${uri}/${upload.originalName}` : uri

    const signedUrl = upload.signedUrl
    if (!signedUrl) return

    const base64 = await signedUrlToBase64(signedUrl)

    return {
      type: 'resource',
      resource: {
        uri: fullUri,
        mimeType: base64.mimeType,
        data: base64.data
      }
    } 
  }
}