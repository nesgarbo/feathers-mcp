import type { TSchema } from '@feathersjs/typebox'
import { z, type ZodRawShape } from 'zod'
import { typeboxToZod } from './typebox-to-zod.js'

/**
 * Builds the Zod shape the MCP SDK wants for a tool's input.
 *
 * Built straight from the TypeBox properties rather than by converting the whole schema and testing
 * the result with `instanceof ZodObject`: a top-level `default` on the schema wraps it in a
 * `ZodDefault`, and that check would then throw at the first client connection — a 500 on
 * `initialize` — rather than where the mistake actually is.
 */
export const typeboxToZodObject = (typeboxSchema: TSchema): z.ZodObject<ZodRawShape> => {
  const schema = typeboxSchema as any

  if (schema?.type !== 'object' || !schema.properties) {
    throw new Error(
      'feathers-mcp: a tool input schema must be a Type.Object(...) — MCP tool arguments are ' +
        'always a named object.'
    )
  }

  const required: string[] = schema.required ?? []
  // Built as a mutable record: zod 4 types `ZodRawShape` itself as readonly.
  const shape: Record<string, z.ZodTypeAny> = {}

  for (const [key, propSchema] of Object.entries(schema.properties)) {
    const zodProp = typeboxToZod(propSchema as TSchema)
    shape[key] = required.includes(key) ? zodProp : zodProp.optional()
  }

  const objectSchema = z.object(shape)
  return schema.additionalProperties === false ? objectSchema.strict() : objectSchema
}
