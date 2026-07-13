import type { TSchema } from '@sinclair/typebox'
import { z } from 'zod'
import { warn } from '../mcp/logger.js'

/**
 * Converts a TypeBox schema to a Zod schema, because the MCP SDK only accepts Zod
 * (`AnySchema = ZodTypeAny | $ZodType` — raw JSON Schema is not an option) while Feathers apps
 * describe everything in TypeBox.
 *
 * Order matters here. TypeBox emits `Type.Literal('a')` as `{ const: 'a', type: 'string' }` — it
 * carries a `type` — so dispatching on `type` first silently turns every literal, literal union and
 * enum into a bare `z.string()`: no validation, and the allowed values never even reach the model in
 * the advertised tool schema. `const`/`enum`/combinators are therefore checked before `type`.
 */
export const typeboxToZod = (typeboxSchema: TSchema): z.ZodTypeAny => {
  const schema = typeboxSchema as any

  /**
   * Only `description` and `default` survive the trip — they are what actually reaches the model
   * through the MCP tool schema.
   */
  const applyMetadata = <T extends z.ZodTypeAny>(zodSchema: T): T => {
    let result = zodSchema

    if (schema.description) {
      result = result.describe(schema.description as string) as T
    }
    if (schema.default !== undefined) {
      result = result.default(schema.default) as unknown as T
    }

    return result
  }

  // --- literals and enums, before the `type` switch can swallow them ---

  if ('const' in schema) {
    return applyMetadata(z.literal(schema.const))
  }

  if (Array.isArray(schema.enum)) {
    if (schema.enum.length === 0) return z.never()
    const allStrings = schema.enum.every((v: unknown) => typeof v === 'string')
    return applyMetadata(
      allStrings
        ? (z.enum(schema.enum as [string, ...string[]]) as unknown as z.ZodTypeAny)
        : unionOf(schema.enum.map((v: unknown) => z.literal(v as any)))
    )
  }

  // --- combinators ---

  const anyOf = schema.anyOf ?? schema.oneOf
  if (Array.isArray(anyOf)) {
    if (anyOf.length === 0) return z.never()
    return applyMetadata(unionOf(anyOf.map((s: TSchema) => typeboxToZod(s))))
  }

  if (Array.isArray(schema.allOf)) {
    if (schema.allOf.length === 0) return z.any()

    let merged = typeboxToZod(schema.allOf[0] as TSchema)
    for (const part of schema.allOf.slice(1)) {
      const next = typeboxToZod(part as TSchema)
      merged =
        merged instanceof z.ZodObject && next instanceof z.ZodObject
          ? merged.extend(next.shape)
          : z.intersection(merged, next)
    }
    return applyMetadata(merged)
  }

  if ('$ref' in schema) {
    // Resolving these needs a schema registry the converter does not have. Left as `any`, but said
    // out loud — a silent `any` on a tool input means the model can send anything at all.
    warn(
      `tool schema uses $ref ('${schema.$ref}'), which this converter cannot resolve; ` +
        'that field will accept any value. Inline the schema instead of using Type.Ref.'
    )
    return z.any()
  }

  // --- primitives and containers ---

  switch (schema.type) {
    case 'string': {
      let stringSchema = z.string()
      if (schema.format === 'email') stringSchema = stringSchema.email()
      else if (schema.format === 'uri' || schema.format === 'url') stringSchema = stringSchema.url()
      else if (schema.format === 'uuid') stringSchema = stringSchema.uuid()
      else if (schema.format === 'date-time') stringSchema = stringSchema.datetime()

      if (schema.minLength !== undefined) stringSchema = stringSchema.min(schema.minLength)
      if (schema.maxLength !== undefined) stringSchema = stringSchema.max(schema.maxLength)
      if (schema.pattern !== undefined) stringSchema = stringSchema.regex(new RegExp(schema.pattern))

      return applyMetadata(stringSchema)
    }

    case 'number':
    case 'integer': {
      let numberSchema = schema.type === 'integer' ? z.number().int() : z.number()
      if (schema.minimum !== undefined) numberSchema = numberSchema.min(schema.minimum)
      if (schema.maximum !== undefined) numberSchema = numberSchema.max(schema.maximum)
      if (schema.exclusiveMinimum !== undefined) numberSchema = numberSchema.gt(schema.exclusiveMinimum)
      if (schema.exclusiveMaximum !== undefined) numberSchema = numberSchema.lt(schema.exclusiveMaximum)
      if (schema.multipleOf !== undefined) numberSchema = numberSchema.multipleOf(schema.multipleOf)

      return applyMetadata(numberSchema)
    }

    case 'boolean':
      return applyMetadata(z.boolean())

    case 'null':
      return applyMetadata(z.null())

    case 'object':
      return applyMetadata(objectToZod(schema))

    case 'array':
      return applyMetadata(arrayToZod(schema))

    default:
      // Type.Any / Type.Unknown have no `type` at all and land here.
      return applyMetadata(z.any())
  }
}

const unionOf = (options: z.ZodTypeAny[]): z.ZodTypeAny =>
  options.length === 1 ? options[0] : z.union(options as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]])

/**
 * `z.object({})` strips every unknown key, so an object schema with no `properties` — which is how
 * TypeBox emits `Type.Record` and `Type.Date` — used to hand the tool handler an empty object with
 * no error and no warning. Records become records; a Date becomes a coerced date, since a model can
 * only ever send one as a string.
 */
const objectToZod = (schema: any): z.ZodTypeAny => {
  if (schema.properties) {
    const required: string[] = schema.required ?? []
    const shape: Record<string, z.ZodTypeAny> = {}

    for (const [key, propSchema] of Object.entries(schema.properties)) {
      const zodProp = typeboxToZod(propSchema as TSchema)
      shape[key] = required.includes(key) ? zodProp : zodProp.optional()
    }

    const objectSchema = z.object(shape)
    return schema.additionalProperties === false ? objectSchema.strict() : objectSchema
  }

  if (schema.instanceOf === 'Date') {
    return z.coerce.date()
  }

  // Type.Record: the value schema hides in patternProperties, or in additionalProperties.
  const patternValue = schema.patternProperties
    ? (Object.values(schema.patternProperties)[0] as TSchema | undefined)
    : undefined
  const valueSchema =
    patternValue ??
    (typeof schema.additionalProperties === 'object' ? (schema.additionalProperties as TSchema) : undefined)

  return z.record(z.string(), valueSchema ? typeboxToZod(valueSchema) : z.unknown())
}

/** An `items` that is an array means a tuple; treating it as a plain array erased the positions. */
const arrayToZod = (schema: any): z.ZodTypeAny => {
  if (Array.isArray(schema.items)) {
    return z.tuple(schema.items.map((s: TSchema) => typeboxToZod(s)) as [z.ZodTypeAny, ...z.ZodTypeAny[]])
  }

  let arraySchema = z.array(schema.items ? typeboxToZod(schema.items as TSchema) : z.unknown())

  if (schema.minItems !== undefined) arraySchema = arraySchema.min(schema.minItems)
  if (schema.maxItems !== undefined) arraySchema = arraySchema.max(schema.maxItems)

  // `refine` returns a wrapper, so it must come last — applying it to the base schema would throw
  // away the min/max constraints set above.
  return schema.uniqueItems === true
    ? arraySchema.refine((items) => new Set(items).size === items.length, {
        message: 'Array items must be unique'
      })
    : arraySchema
}
