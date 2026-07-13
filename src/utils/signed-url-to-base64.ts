import { Buffer } from 'node:buffer'
import { debug } from '../mcp/logger.js'

export interface Base64File {
  /** Raw base64. MCP content blocks reject a `data:` URI here. */
  data: string
  mimeType: string
  size: number
}

/** Base64 inflates by ~33%, and the whole thing is held in memory and then in a JSON-RPC message. */
export const DEFAULT_MAX_BYTES = 25 * 1024 * 1024

export async function signedUrlToBase64(
  signedUrl: string,
  maxBytes: number = DEFAULT_MAX_BYTES
): Promise<Base64File> {
  const response = await fetch(signedUrl)

  if (!response.ok) {
    throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
  }

  const mimeType = response.headers.get('content-type') ?? 'application/octet-stream'

  // Trust the header when it is there, but do not rely on it: it is advisory, and buffering the
  // body unconditionally is how one oversized upload takes the whole process down.
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw new Error(`File is ${declared} bytes, over the ${maxBytes}-byte limit`)
  }

  const buffer = await readCapped(response, maxBytes)
  debug(`downloaded ${buffer.length} bytes (${mimeType}) from signed URL`)

  return {
    data: buffer.toString('base64'),
    mimeType,
    size: buffer.length
  }
}

const readCapped = async (response: Response, maxBytes: number): Promise<Buffer> => {
  if (!response.body) {
    return Buffer.from(await response.arrayBuffer())
  }

  const chunks: Uint8Array[] = []
  let total = 0

  const reader = response.body.getReader()
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break

      total += value.length
      if (total > maxBytes) {
        throw new Error(`File exceeds the ${maxBytes}-byte limit`)
      }
      chunks.push(value)
    }
  } finally {
    reader.cancel().catch(() => {})
  }

  return Buffer.concat(chunks, total)
}
