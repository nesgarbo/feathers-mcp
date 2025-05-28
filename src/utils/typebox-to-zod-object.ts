import { TSchema } from "@feathersjs/typebox"
import { z, ZodRawShape } from 'zod'
import { typeboxToZod } from './typebox-to-zod.js'

export const typeboxToZodObject = (typeboxSchema: TSchema): z.ZodObject<ZodRawShape> => {
  const zodSchema = typeboxToZod(typeboxSchema)
  if (zodSchema instanceof z.ZodObject) {
    return zodSchema
  } else {
    throw new Error('Schema must be an object for MCP tool input/output')
  }
}