import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  // website/ is an independent Astro subproject with its own toolchain and build output — not
  // part of the library this config lints.
  { ignores: ['dist/**', 'website/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // The Feathers/MCP boundary is genuinely untyped in places (raw req/res, service lookups).
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
    }
  }
)
