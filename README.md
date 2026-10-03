# Mockwave

> Generate realistic mock data with the copy-as-code pattern

**Mockwave** is the third app in **WaveRider** (Rackwave: audio, Fluxwave: UI, **Mockwave: data**). It applies the proven copy-as-code pattern to data mocking: import your real data schema, configure mocking rules, and copy the generated mock data back into your project.

```
Paste your schema -> Configure mocks -> Generate realistic data -> Copy mock code
```

## The WaveRider Pattern

All WaveRider apps follow the same pattern:

| App | Domain | Pattern |
|-----|--------|---------|
| **Rackwave** | Audio (Web Audio API) | Import code -> tune -> export patched code |
| **Fluxwave** | UI (React/JSX) | Import code -> edit -> export patched code |
| **Mockwave** | Data (Schemas) | Import schema -> configure -> export mock data |

Each app:
- Parses real source code **deterministically** (no AI required)
- Lets you interact with recognized values
- Hands back **exact** modified code with only your changes
- Falls back to AI only when the parser can't recognize something

## Quick Start

```bash
# Clone and install
cd mockwave
npm install

# Run the dev server
npm run dev

# Open in browser
# http://localhost:3003
```

Paste a TypeScript interface, JSON Schema, or plain JSON object, and Mockwave will:
1. Parse your schema
2. Identify fields and their types
3. Generate realistic mock data
4. Let you copy the result

## Example

### Input (TypeScript Interface)

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  isActive: boolean;
  createdAt: Date;
  address: {
    street: string;
    city: string;
    zip: string;
  };
  tags: string[];
}
```

### Output (Mock Data)

```typescript
export const mockUser: User = {
  id: 'a1b2c3d4-e5f6-7890-g1h2-i3j4k5l6m7n8',
  name: 'Sarah Johnson',
  email: 'sarah.johnson@example.com',
  age: 34,
  isActive: true,
  createdAt: '2026-03-15T10:24:00.000Z',
  address: {
    street: '1234 Elm Street',
    city: 'Denver',
    zip: '80202',
  },
  tags: ['premium', 'active', 'verified'],
};
```

## Supported Schema Formats

| Format | Example | Status |
|--------|---------|--------|
| TypeScript Interface | `interface User { ... }` | Supported |
| TypeScript Type | `type User = { ... }` | Supported |
| JSON Schema | `{ type: object, ... }` | Supported |
| Plain JSON | `{ id: 123, name: ... }` | Supported |
| Zod Schema | `z.object({ ... })` | Planned |
| Yup Schema | `yup.object({ ... })` | Planned |
| GraphQL SDL | `type User { id: ID! }` | Supported |

## Features

### Deterministic Parsing
- Extracts schema structure from your source code
- Tracks exact source positions for in-place modifications
- Handles nested objects, arrays, and primitive types

### Smart Mock Generation
- Field name heuristics: id -> UUID, createdAt -> Date, etc.
- Type-based generation: strings, numbers, booleans, dates, nulls
- Format support: UUID, email, URL, phone, address, name, etc.
- Array support: Configurable length and item types
- Optional fields: Randomly included based on probability
- Seeded runs: the same `seed` option always produces identical output

### Copy-as-Code
- Generate mock data in your original format
- Copy directly into your codebase
- Diff view to see what changed

### Coming Soon
- Patched source output (original schema with mock values inline)
- Unified diff output
- More schema formats (Zod, Yup)
- Custom mock generators
- Team collaboration

## Architecture

```
mockwave/
├── app/                          # Frontend (React + Vite)
│   └── src/
│       ├── main.tsx              # Entry point
│       ├── App.tsx               # Main app component
│       └── index.css            # Styles (WaveRider theme)
│
└── engine/                       # Core logic (@mockwave/engine)
    └── src/
        ├── index.ts              # Package exports
        ├── types.ts              # Type definitions
        ├── codeImport.ts         # Schema parser + patch/diff
        └── mockGenerator.ts       # Mock data generator
```

## Project Status

This is a scaffold (first milestone). The basic structure is in place, but many features are stubbed or partially implemented. See SCOPING-MEMO-mockwave.md for full details.

## Contributing

Part of the OneLyf ecosystem. See the main repository for contribution guidelines.

## License

MIT
