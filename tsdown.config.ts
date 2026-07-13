import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: 'src/index.ts',
  format: ['esm', 'cjs'],
  dts: true,
  target: 'es2022',
  outDir: 'dist',
  // The Feathers app and the MCP SDK come from the host app; bundling them would ship two copies.
  external: [/^@feathersjs\//, /^@modelcontextprotocol\//, /^@sinclair\//, 'zod']
})
