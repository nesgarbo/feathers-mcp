import { TSchema } from '@feathersjs/typebox'

export function convertTypeboxToJsonSchema(schema: TSchema): any {
  const jsonSchema = schema?.toJSON?.() ?? schema

  if (typeof jsonSchema === 'object' && '$id' in jsonSchema) {
    const { $id, ...rest } = jsonSchema
    return rest
  }

  return jsonSchema
}