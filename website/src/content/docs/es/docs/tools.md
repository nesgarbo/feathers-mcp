---
title: Escribir tools
description: Extiende BaseTool, define esquemas TypeBox, y registra la tool con feathersMcp().
---

Las tools son el punto de extensión. Extiende `BaseTool`, dale un nombre, una descripción,
`inputSchema`/`outputSchema` en TypeBox, un mapa `expose`, y un `handler`:

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
  description = "Repite un texto N veces";
  // El input schema debe ser un Type.Object — los inputs de tools de MCP siempre son objetos.
  static inputSchema = Type.Object({
    text: Type.String({ description: "Texto a repetir" }),
    times: Type.Number({ description: "Número de repeticiones" }),
  });
  static outputSchema = Type.String({ description: "Texto repetido" });
  inputSchema = RepeatTextTool.inputSchema;
  outputSchema = RepeatTextTool.outputSchema;
  expose = { mcp: true, openai: true };

  async handler(
    { text, times }: Static<typeof RepeatTextTool.inputSchema>,
    // Los params autenticados de Feathers del llamante, incluyendo params.user.
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

Regístrala pasando la clase a `feathersMcp()`:

```ts
app.configure(feathersMcp({ tools: [RepeatTextTool] }));
```

## Nombres de tools con tipado seguro

Aumentar `McpToolMap` (reexportado por la biblioteca para que el augmentation realmente se
fusione) es lo que da tipado seguro a los nombres de tools en el resto de tu app — consulta la
sección de module augmentation del [README](https://github.com/nesgarbo/feathers-mcp#readme)
para el patrón completo.

## `expose`

`expose` es **estático y global** — toda clave autenticada ve la misma lista de tools. La
autorización por usuario va en hooks de Feathers sobre los servicios que llama un handler, no
aquí:

- `expose.mcp` — si la tool se anuncia a los clientes MCP.
- `expose.openai` — si la tool se incluye en los esquemas de function-calling de OpenAI que
  devuelve `McpToolHandler.getForOpenAi()`, para apps anfitrionas que también los quieran.

## Por qué TypeBox, no Zod, en la frontera que tú escribes

Los esquemas son TypeBox en la frontera de autor y Zod en la frontera del SDK de MCP — el tipo
de esquema del SDK no acepta JSON Schema crudo. La conversión ocurre en el registro, así que un
esquema mal formado falla al arrancar con el nombre de la tool ofensora adjunto, en vez de
aparecer como un 500 en el primer `initialize` de un cliente. Dos tools registrando el mismo
nombre también falla al arrancar.

:::note[Solo esquemas de objeto]
`inputSchema` debe ser un `Type.Object` — los inputs de tools de MCP siempre son objetos. Un
esquema que no sea objeto falla el registro inmediatamente.
:::

Consulta [Valores de retorno](/es/docs/return-values/) para lo que puede devolver un handler, y
[Llamar a otros servicios](/es/docs/calling-services/) para la única regla que importa cuando un
handler llama al resto de tu app.
