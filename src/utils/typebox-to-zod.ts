import { TSchema } from '@sinclair/typebox'
import { z } from 'zod'

/**
 * Converts a TypeBox schema to a Zod schema
 * Preserves descriptions, validations, and other metadata
 * @param typeboxSchema The TypeBox schema to convert
 * @returns Equivalent Zod schema
 */
export const typeboxToZod = (typeboxSchema: TSchema): z.ZodTypeAny => {
  /**
   * Applies metadata from TypeBox schema to Zod schema
   * Preserves descriptions, titles, examples, and default values
   */
  const applyMetadata = <T extends z.ZodTypeAny>(zodSchema: T, schema: TSchema): T => {
    let result = zodSchema

    // Apply description
    if ('description' in schema && schema.description) {
      result = result.describe(schema.description as string) as T
    }

    // Add title as custom metadata
    if ('title' in schema && schema.title) {
      // @ts-ignore - Add title as custom metadata
      result._def.meta = result._def.meta || {}
      // @ts-ignore
      result._def.meta.title = schema.title
    }

    // Add examples as custom metadata
    if ('examples' in schema && schema.examples) {
      // @ts-ignore - Add examples as custom metadata
      result._def.meta = result._def.meta || {}
      // @ts-ignore
      result._def.meta.examples = schema.examples
    } else if ('example' in schema && schema.example) {
      // @ts-ignore
      result._def.meta = result._def.meta || {}
      // @ts-ignore
      result._def.meta.examples = [schema.example]
    }

    // Apply default value
    if ('default' in schema && schema.default !== undefined) {
      result = result.default(schema.default) as unknown as T
    }

    return result
  }

  // Check schema type
  if ('type' in typeboxSchema) {
    switch (typeboxSchema.type) {
      case 'string': {
        let stringSchema = z.string()
        if (typeboxSchema.format === 'email') {
          stringSchema = stringSchema.email()
        } else if (typeboxSchema.format === 'uri') {
          stringSchema = stringSchema.url()
        } else if (typeboxSchema.format === 'date-time') {
          stringSchema = stringSchema.datetime()
        }

        if (typeboxSchema.minLength !== undefined) {
          stringSchema = stringSchema.min(typeboxSchema.minLength)
        }
        if (typeboxSchema.maxLength !== undefined) {
          stringSchema = stringSchema.max(typeboxSchema.maxLength)
        }
        if (typeboxSchema.pattern !== undefined) {
          stringSchema = stringSchema.regex(new RegExp(typeboxSchema.pattern))
        }

        return applyMetadata(stringSchema, typeboxSchema)
      }

      case 'number': {
        let numberSchema = z.number()
        if (typeboxSchema.minimum !== undefined) {
          numberSchema = numberSchema.min(typeboxSchema.minimum)
        }
        if (typeboxSchema.maximum !== undefined) {
          numberSchema = numberSchema.max(typeboxSchema.maximum)
        }
        if (typeboxSchema.multipleOf !== undefined) {
          numberSchema = numberSchema.multipleOf(typeboxSchema.multipleOf)
        }

        return applyMetadata(numberSchema, typeboxSchema)
      }

      case 'integer': {
        let intSchema = z.number().int()
        if (typeboxSchema.minimum !== undefined) {
          intSchema = intSchema.min(typeboxSchema.minimum)
        }
        if (typeboxSchema.maximum !== undefined) {
          intSchema = intSchema.max(typeboxSchema.maximum)
        }

        return applyMetadata(intSchema, typeboxSchema)
      }

      case 'boolean': {
        return applyMetadata(z.boolean(), typeboxSchema)
      }

      case 'null': {
        return applyMetadata(z.null(), typeboxSchema)
      }

      case 'object': {
        if (typeboxSchema.properties) {
          const shape: Record<string, z.ZodTypeAny> = {}
          const required = typeboxSchema.required || []

          for (const [key, propSchema] of Object.entries(typeboxSchema.properties)) {
            const zodProp = typeboxToZod(propSchema as TSchema)
            shape[key] = required.includes(key) ? zodProp : zodProp.optional()
          }

          // Create the base object schema
          const baseObjectSchema = z.object(shape)

          // Apply additional constraints
          let finalObjectSchema: z.ZodType
          if (typeboxSchema.additionalProperties === false) {
            finalObjectSchema = baseObjectSchema.strict()
          } else {
            finalObjectSchema = baseObjectSchema
          }

          // Apply metadata and return
          return applyMetadata(finalObjectSchema, typeboxSchema)
        }
        return applyMetadata(z.object({}), typeboxSchema)
      }

      case 'array': {
        if (typeboxSchema.items) {
          // Create base array schema
          const baseArraySchema = z.array(typeboxToZod(typeboxSchema.items as TSchema))

          // Apply constraints
          let finalArraySchema: z.ZodType = baseArraySchema

          if (typeboxSchema.minItems !== undefined) {
            finalArraySchema = baseArraySchema.min(typeboxSchema.minItems)
          }

          if (typeboxSchema.maxItems !== undefined) {
            if (finalArraySchema instanceof z.ZodArray) {
              finalArraySchema = finalArraySchema.max(typeboxSchema.maxItems)
            }
          }

          // Handle uniqueItems constraint
          if (typeboxSchema.uniqueItems === true) {
            // For uniqueItems, we need to use refine
            // We need to recreate the schema to avoid the typing issues
            finalArraySchema = baseArraySchema.refine((items) => new Set(items).size === items.length, {
              message: 'Array items must be unique'
            })
          }

          // Apply metadata and return
          return applyMetadata(finalArraySchema, typeboxSchema)
        }
        return applyMetadata(z.array(z.unknown()), typeboxSchema)
      }

      default:
        return z.any()
    }
  } else if ('enum' in typeboxSchema && Array.isArray(typeboxSchema.enum)) {
    // Handle enumerations
    // Make sure we have at least one enum value for typing
    if (typeboxSchema.enum.length === 0) {
      return z.never()
    }

    const enumValues = typeboxSchema.enum as [string, ...string[]]
    const enumSchema = z.enum(enumValues)
    return applyMetadata(enumSchema, typeboxSchema)
  } else if ('const' in typeboxSchema) {
    // Handle constant values
    const literalSchema = z.literal(typeboxSchema.const)
    return applyMetadata(literalSchema, typeboxSchema)
  } else if (typeboxSchema.anyOf || typeboxSchema.oneOf) {
    // Handle unions
    const unionTypes = (typeboxSchema.anyOf || typeboxSchema.oneOf || []).map((schema: TSchema) =>
      typeboxToZod(schema)
    )

    // Make sure we have at least one type for the union
    if (unionTypes.length === 0) {
      return z.never()
    }

    const unionSchema = z.union(unionTypes)
    return applyMetadata(unionSchema, typeboxSchema)
  } else if (typeboxSchema.allOf) {
    // Handle intersections (allOf)
    if (typeboxSchema.allOf.length === 0) {
      return z.any()
    }

    let baseSchema = typeboxToZod(typeboxSchema.allOf[0] as TSchema)

    for (let i = 1; i < typeboxSchema.allOf.length; i++) {
      const schema = typeboxToZod(typeboxSchema.allOf[i] as TSchema)

      // For object schemas, we can merge them
      if (baseSchema instanceof z.ZodObject && schema instanceof z.ZodObject) {
        baseSchema = baseSchema.merge(schema)
      }
      // For other types, we can use intersection (less common)
      else {
        baseSchema = z.intersection(baseSchema, schema)
      }
    }

    return applyMetadata(baseSchema, typeboxSchema)
  } else if ('$ref' in typeboxSchema) {
    // References are more complex and would require a registry
    console.warn('$ref handling is not implemented in this converter. Using any() type.')
    return z.any()
  }

  return z.any()
}

/**
 * Example usage:
 *
 * import { Type } from '@sinclair/typebox';
 *
 * const UserTypeBox = Type.Object({
 *   name: Type.String({
 *     description: 'The user\'s full name'
 *   }),
 *   age: Type.Number({
 *     description: 'The user\'s age in years',
 *     minimum: 0
 *   }),
 *   email: Type.Optional(Type.String({
 *     format: 'email',
 *     description: 'The user\'s email address'
 *   }))
 * }, {
 *   description: 'User information schema'
 * });
 *
 * const UserZod = typeboxToZod(UserTypeBox);
 */