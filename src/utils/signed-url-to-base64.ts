import { Buffer } from 'buffer'

// Función principal para convertir signed URL a base64
export async function signedUrlToBase64(signedUrl: string): Promise<{
  data: string
  mimeType: string
  size: number
}> {
  try {
    console.log('Downloading file from signed URL...')
    
    const response = await fetch(signedUrl)
    
    if (!response.ok) {
      throw new Error(`Failed to fetch file: ${response.status} ${response.statusText}`)
    }

    // Obtener Content-Type del header
    const contentType = response.headers.get('content-type') || 'application/octet-stream'
    
    // Convertir a buffer
    const arrayBuffer = await response.arrayBuffer()
    const buffer = Buffer.from(arrayBuffer)
    
    // Convertir a base64
    const base64Data = buffer.toString('base64')
    
    console.log(`File downloaded: ${buffer.length} bytes, type: ${contentType}`)
    
    return {
      data: `data:${contentType};base64,${base64Data}`,
      mimeType: contentType,
      size: buffer.length
    }
    
  } catch (error) {
    console.error('Error downloading file from signed URL:', error)
    throw new Error(`Failed to download file: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}