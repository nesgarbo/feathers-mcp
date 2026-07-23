---
title: Llamar a otros servicios
description: Reenvía siempre los params del handler — omitirlos convierte cualquier argumento id en un IDOR.
---

**Reenvía siempre los `params` del handler** al llamar a otro servicio desde una tool. Una
llamada a un servicio sin params es una llamada *interna* — `params.provider` es undefined — y
cualquier hook de autorización escrito de la forma habitual
(`if (context.params.provider)`) se salta, `authenticate()` incluido.

```ts
async handler(input: Static<typeof MyTool.inputSchema>, params: McpParams, emit: EmitFunction) {
  // Reenvía params. No llames a app.service('uploads').get(input.uploadId) a pelo.
  const record = await this.app.service("uploads").get(input.uploadId, params);
  // ...
}
```

Como los argumentos de una tool vienen del modelo, omitir params convierte cualquier argumento
id que el modelo aporte en un IDOR: la autorización que tus hooks de `uploads` aplican en una
petición real nunca corre, y la tool obtendrá alegremente un registro perteneciente a otro
usuario.

:::caution[Esto ya se envió como un bug real una vez]
`BaseTool.resourceFromUploadId` originalmente llamaba a `uploads.get(id)` sin params — exactamente
este bug. Ahora exige `params` como parámetro y se niega a correr sin ellos. Consulta la
[entrada del changelog de 2.0.0](https://github.com/nesgarbo/feathers-mcp/blob/main/CHANGELOG.md)
para el detalle completo.
:::
