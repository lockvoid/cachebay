# @cachebay/vite

Vite plugin for Cachebay GraphQL query precompilation.

## Features

- 🚀 **Zero runtime overhead** - Queries are compiled at build time
- 📦 **Smaller bundles** - No need to ship GraphQL parser/compiler
- ⚡ **Faster startup** - No parsing/compiling on app load
- 🔧 **Drop-in replacement** - Works with existing `gql` tagged templates

## Installation

```bash
pnpm add -D @cachebay/vite
```

## Usage

```typescript
// vite.config.ts
import { defineConfig } from 'vite';
import cachebay from '@cachebay/vite';

export default defineConfig({
  plugins: [
    cachebay({
      // Optional: customize file patterns
      include: ['**/*.{js,ts,vue}'],
      exclude: ['node_modules/**'],
      debug: false,
    }),
  ],
});
```

## How it works

The plugin transforms `gql` tagged templates at build time:

**Before:**
```typescript
import { gql } from 'graphql-tag';

const USER_QUERY = gql`
  query GetUser($id: ID!) {
    user(id: $id) {
      id
      name
      email
    }
  }
`;
```

**After:**
```typescript
const USER_QUERY = {
  kind: "CachePlan",
  operation: "query",
  // ... precompiled plan
};
```

## Options

- `include` - File patterns to transform (default: `['**/*.{js,jsx,ts,tsx,vue}']`)
- `exclude` - File patterns to skip (default: `['node_modules/**', 'dist/**']`)
- `debug` - Enable debug logging (default: `false`)

## License

MIT
