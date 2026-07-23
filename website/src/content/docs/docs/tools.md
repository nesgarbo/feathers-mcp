---
title: Writing tools
description: Extend BaseTool, define TypeBox schemas, and register the tool with feathersMcp().
---

Tools are the extension point. Extend `BaseTool`, give it a name, a description, TypeBox
`inputSchema`/`outputSchema`, an `expose` map, and a `handler`:

```ts
import { Static, Type } from "@feathersjs/typebox";
import { McpParams, BaseTool, ToolResponse } from "feathers-mcp";
import type { EmitFunction, InferMcpToolType } from "feathers-mcp";

export const REPEAT_TEXT_TOOL_NAME = "repeat_text" as const;

export class RepeatTextTool extends BaseTool<
  typeof REPEAT_TEXT_TOOL_NAME,
  typeof RepeatTextTool.inputSchema,
  typeof RepeatTextTool.outputSchema
> {
  name = REPEAT_TEXT_TOOL_NAME;
  description = "Repeats a piece of text N times";
  // The input schema must be a Type.Object — MCP tool inputs are always objects.
  static inputSchema = Type.Object({
    text: Type.String({ description: "Text to repeat" }),
    times: Type.Number({ description: "Number of repetitions" }),
  });
  static outputSchema = Type.String({ description: "Repeated text" });
  inputSchema = RepeatTextTool.inputSchema;
  outputSchema = RepeatTextTool.outputSchema;
  expose = { mcp: true, openai: true };

  async handler(
    { text, times }: Static<typeof RepeatTextTool.inputSchema>,
    // The authenticated Feathers params of the caller, including `params.user`.
    params: McpParams,
    emit: EmitFunction
  ) {
    emit("Starting text repetition...", 0);
    const result = text.repeat(times);
    emit("Text repetition completed!", 100);
    return { text: { type: "text", data: result } } as ToolResponse<
      Static<typeof RepeatTextTool.outputSchema>
    >;
  }
}

declare module "feathers-mcp" {
  interface McpToolMap {
    [REPEAT_TEXT_TOOL_NAME]: InferMcpToolType<RepeatTextTool>;
  }
}
```

Register it by passing the class to `feathersMcp()`:

```ts
app.configure(feathersMcp({ tools: [RepeatTextTool] }));
```

## Type-safe tool names

Augmenting `McpToolMap` (re-exported from the library so the augmentation actually merges) is
what makes tool names type-safe elsewhere in your app — see the [module augmentation section of
the README](https://github.com/nesgarbo/feathers-mcp#readme) for the full pattern.

## `expose`

`expose` is **static and global** — every authenticated key sees the same tool list. Per-user
authorization belongs in Feathers hooks on the services a handler calls, not here:

- `expose.mcp` — whether the tool is advertised to MCP clients.
- `expose.openai` — whether the tool is included in `McpToolHandler.getForOpenAi()`'s OpenAI
  function-calling schemas, for host apps that also want those.

## Why TypeBox, not Zod, at the boundary you write

Schemas are TypeBox at the author boundary and Zod at the MCP SDK boundary — the SDK's schema
type doesn't accept raw JSON Schema. The conversion happens at registration, so a malformed
schema fails at boot with the offending tool's name attached, rather than surfacing as a 500 on
a client's first `initialize`. Two tools registering the same name also throws at boot.

:::note[Object schemas only]
`inputSchema` must be a `Type.Object` — MCP tool inputs are always objects. A non-object schema
fails registration immediately.
:::

See [Return values](/docs/return-values/) for what a handler can return, and
[Calling other services](/docs/calling-services/) for the one rule that matters when a handler
calls into the rest of your app.
