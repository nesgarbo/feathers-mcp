import type { Static, TSchema } from '@feathersjs/typebox'
import type { McpApplication } from './app.js'
import type { Params } from '@feathersjs/feathers'

export interface McpToolBase<
  Name extends string,
  InputSchema extends TSchema,
  OutputSchema extends TSchema
> {
  name: Name
  inputSchema: InputSchema
  outputSchema: OutputSchema
  handler: (
    input: Static<InputSchema>,
    app: McpApplication,
    params?: Params
  ) => Promise<Static<OutputSchema>>
}

// Interface to be extended via module augmentation
export interface McpToolMap {}