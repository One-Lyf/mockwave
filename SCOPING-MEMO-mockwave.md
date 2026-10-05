# Scoping Memo: Mockwave Standalone Ship

**Node:** `mockwave-standalone-ship`  
**Owner:** whisperers  
**Priority:** FRONTIER (w5, reopened 2026-09-05, unblocks waves-first-revenue)  
**Status:** Scaffold complete, repo created  

---

## What

Build Mockwave as a standalone application — the third member of the suite (Rackwave: audio, Fluxwave: UI, **Mockwave: data**). Mockwave applies the **copy-as-code pattern** to data mocking: import your real data schema, configure mocking rules, generate realistic mock data, and copy the generated code back into your project.

This node covers **scaffold-only** (first milestone per DISPATCH):
- [x] Repository created (`github.com/One-Lyf/mockwave`)
- [x] Basic app shell (React + Vite + TypeScript)
- [x] Engine package structure (`@mockwave/engine`)
- [x] Core code import pattern (mirroring Rackwave's deterministic parse-first approach)
- [x] Mock generator with realistic data patterns
- [x] Scoping doc (this memo)

Full standalone-ship parity with Rackwave/Fluxwave is a **later gate**, not this one.

---

## Why

Jeff's live directive (2026-09-05): "Have Whisperers begin scaffolding Mockwave too." The suite has proven the copy-as-code pattern works:

- **Rackwave** (audio): import Web Audio code → tune → export patched code with only audio values changed
- **Fluxwave** (UI): import UI code → edit → export patched code with only visual/behavioral values changed  
- **Mockwave** (data): import data schema → configure mocks → export generated mock data that matches your structure

Mockwave completes the suite by applying the same pattern to data. Developers need realistic mock data for testing, prototyping, and development — Mockwave provides this with the same deterministic-first, AI-fallback approach as Rackwave.

---

## Current State

### Repository Structure

```
mockwave/
├── package.json                 # Workspace root
├── tsconfig.base.json
├── vite.config.ts
├── README.md
├── SCOPING-MEMO-mockwave.md    # This document
├── app/                        # Frontend (React + Vite)
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx           # Entry point
│   │   ├── App.tsx            # Main app component
│   │   └── index.css         # Base styles (suite theme)
│   └── public/
│       └── favicon.svg
└── engine/                     # Core logic package
    ├── package.json
    ├── tsconfig.json
    └── src/
        ├── index.ts           # Package exports
        ├── types.ts           # Type definitions (MockConfig, etc.)
        ├── codeImport.ts       # Deterministic schema parser (mirrors Rackwave)
        └── mockGenerator.ts    # Realistic mock data generator
```

### Core Pattern (Mirroring Rackwave)

```
User Flow:
  1. Paste data schema (TypeScript interface, JSON Schema, plain JSON)
     ↓
  2. parseSchema() → { config, spans, source, recognized, unrecognized }
     ↓
  3. User configures mock rules (field types, formats, ranges)
     ↓
  4. generateMock() → realistic mock data
     ↓
  5. patchCode() → original schema with mock values (future)
     ↓
  6. unifiedDiff() → clean diff showing changes (future)
     ↓
  7. Copy mock code / Copy diff
```

### Module: `codeImport.ts`

Mirrors Rackwave's `engine/src/codeImport.ts`:

- **`parseSchema(code)`**: Main entry point, tries deterministic parsers in order
  - `parseTypeScriptSchema()`: Extracts TypeScript interfaces/types
  - `parseJSONSchema()`: Extracts JSON Schema definitions
  - `parseJSONData()`: Infers schema from plain JSON
  - Returns `SchemaImport` with config, spans, source, recognized, unrecognized

- **`patchCode(import, config)`**: Rewrites recognized values in original source
  - Uses span tracking for in-place modifications
  - Preserves unrecognized code byte-for-byte
  - TODO: Full implementation (scaffold stubs in place)

- **`unifiedDiff(a, b)`**: LCS-based diff generation
  - Zero dependencies, runs in browser
  - Ported from Rackwave's implementation

- **Helper exports**: `IMPORT_PROMPT`, `IMPORT_FORMAT_HELP` for user guidance

### Module: `mockGenerator.ts`

Realistic mock data generation:

- **`generateMock(config, options)`**: Main entry, generates mock from config
- **`generateFromDefinition()`**: Recursively generates from type definitions
- **Primitive generators**:
  - String: with format support (uuid, email, url, phone, address, name, sentence, paragraph)
  - Number: with range, precision, integer constraints
  - Boolean: with probability
  - Date: with date range support
  - Null: null values
  - Any: random primitive type
- **Object generation**: Handles optional fields, custom values, special field names
- **Array generation**: Configurable length (min/max/exact)

### Module: `types.ts`

Type definitions mirroring Rackwave/Fluxwave patterns:

- **`MockConfig`**: Top-level configuration (type, name, root definition)
- **`MockDefinition`**: Union type for object/array/primitive definitions
- **`MockObjectDefinition`**: Object type with properties
- **`MockArrayDefinition`**: Array type with item type and length constraints
- **`MockPrimitiveDefinition`**: Primitive type with format, constraints, defaults
- **`MockPropertyDefinition`**: Property with mock definition + optional/probability
- **`MockValueSpan`**: Source position tracking for patching
- **`MockImport`**: Complete import result
- **`GeneratedMock`**: Generation result with metadata
- **`MockOptions`**: Generation options (seed, count, ranges, formatting)

### Frontend: `App.tsx`

Basic UI structure matching the suite pattern:

- **Import panel**: Textarea for schema input, import button
- **Export panel**: Generated mock output, Code/Diff tabs
- **Copy actions**: "Copy mock code" / "Copy diff" buttons
- **Theme**: Dark theme with accent color (red, matching Rackwave's warm tone)
- **Responsive**: Mobile-first design (390px minimum width)

---

## Architecture Decisions

### 1. Repository Structure

**Decision**: Monorepo-style with `app/` and `engine/` packages (similar to Rackwave).

**Rationale**: 
- Clean separation between frontend and core logic
- Engine can be published as `@mockwave/engine` for use in other contexts
- Matches Rackwave's proven pattern

**Alternatives considered**:
- Single package (simpler but harder to extract engine)
- Separate repos (more overhead, harder coordination)

### 2. Tech Stack

**Decision**: React + Vite + TypeScript

**Rationale**:
- Matches Fluxwave's stack
- Modern, fast, good DX
- Vite supports monorepo workspaces well

### 3. Parse-First Pattern

**Decision**: Deterministic parser first, AI fallback only for unrecognized code

**Rationale**:
- Matches Rackwave's proven pattern (PR #103)
- Users want deterministic, reproducible results
- AI is for enhancement, not core functionality
- Unrecognized code passes through untouched

**Supported schema types (deterministic)**:
1. TypeScript interfaces
2. TypeScript types
3. JSON Schema
4. Plain JSON (infer schema)

**Future** (AI fallback candidates):
- Zod schemas
- Yup schemas
- GraphQL types
- Custom/imported types

### 4. Mock Generation Strategy

**Decision**: Smart defaults + field name heuristics + configurable formats

**Rationale**:
- Field names provide semantic hints (id → UUID, createdAt → Date)
- Type annotations guide value generation
- Format specifiers enable domain-specific mocks (email, url, etc.)
- All configurable per field

**Smart defaults**:
| Field Pattern | Default Type | Example Value |
|--------------|--------------|---------------|
| /id/i | UUID | `123e4567-e89b-12d3-a456-426614174000` |
| /date/i, /at$/i | ISO 8601 | `2026-09-06T10:30:00.000Z` |
| /email/i | Email | `user@example.com` |
| /url/i, /href/i | URL | `https://example.com/path` |
| /phone/i | Phone | `(555) 123-4567` |
| /name/i | Name | `John Smith` |
| /count/i, /length/i | Integer | `42` |
| /price/i, /amount/i | Number | `29.99` |
| /is[A-Z]/ | Boolean | `true` |

### 5. Copy-as-Code Pattern

**Decision**: Three output modes:
1. **Mock Code**: Complete mock data in original format (TypeScript/JSON)
2. **Patched Source** (future): Original schema with mock values inline
3. **Unified Diff** (future): Diff showing what changed

**Rationale**:
- Matches Rackwave's pattern (Code tab, Diff tab)
- Users can copy directly into their projects
- Diff helps understand what Mockwave generated

---

## Risks

### 1. Parser Coverage

**Current**: Basic TypeScript interface/type parsing, JSON Schema, plain JSON

**Gap**: Complex patterns not yet covered:
- Generic types: `Array<T>`, `Record<K, V>`, `Promise<T>`
- Mapped types: `{ [K in keyof T]: ... }`
- Conditional types: `T extends ... ? ... : ...`
- Template literal types: `\`${string}\``
- Imported/custom types not in built-in registry
- Complex JSON Schema features (allOf, anyOf, oneOf)

**Mitigation**:
- Parser can be incrementally improved
- AI fallback path handles unrecognized patterns
- Current coverage sufficient for MVP

### 2. Span Tracking

**Current**: Basic character offset tracking in TypeScript parser

**Gap**: Exact span tracking for complex nested structures, multi-line props

**Mitigation**:
- Current implementation sufficient for scaffold
- Can be refined during Builders phase

### 3. Integration with Existing Tools

**Current**: Standalone app, no integration

**Future considerations**:
- VS Code extension
- CLI tool
- Integration with testing frameworks (Jest, Vitest)
- GitHub Action for PR mock data

**Decision**: Out of scope for scaffold. Focus on standalone web app first.

### 4. Data Format Compatibility

**Current**: TypeScript, JSON Schema, plain JSON

**Future**: Zod, Yup, GraphQL, OpenAPI, Prisma schemas

**Mitigation**: Extensible parser architecture allows adding new formats.

---

## Decision Points for Jeff

| Question | Options | Recommendation |
|----------|---------|----------------|
| Is parse-first, AI-fallback the right approach? | Yes / AI-first | **Yes** — matches proven Rackwave pattern |
| Should we deepen parser before first release? | Yes / No | **No** — current coverage sufficient for MVP |
| Should Mockwave UI match Rackwave/Fluxwave? | Yes / Custom | **Yes** — suite consistency |
| How to handle custom/imported types? | Skip / AI / Extend parser | **AI fallback** — best balance |
| Should mock generation be seeded/reproducible? | Yes / Random | **Yes** — for testing consistency |

---

## Gate Checklist

From DISPATCH.md gate for `mockwave-standalone-ship`:

- [x] Repository created (no repo exists yet → **DONE**)
- [x] Basic app shell (**DONE** - React + Vite + TypeScript)
- [x] Scoping doc for "copy-as-code" pattern applied to data-mocking (**DONE** - this memo)

**Scaffold complete. Full standalone-ship parity is a later gate.**

---

## Next Steps

### Immediate (Whisperers → Builders handoff)
1. **Review**: Jeff review this scaffold and decision points
2. **kingsjustice review**: Cross-model review of the repo structure
3. **PR**: Create initial PR for the scaffold (this commit)
4. **Hand merge**: Hand merges scaffold PR, marks node as done

### Follow-on (Builders)
1. Deepen TypeScript parser (generics, unions, mapped types)
2. Add Zod schema support
3. Add GraphQL type support
4. Implement patchCode() for patched source output
5. Implement full span tracking
6. Wire up Diff tab with unifiedDiff()
7. Add seed-based reproducibility
8. Add more mock formats (Faker.js compatibility?)

### Future (Off-path for now)
1. CLI tool
2. VS Code extension
3. Testing framework integration
4. GitHub Action
5. Self-hosting option
6. Team collaboration features

---

## Related

- DISPATCH.md node: `mockwave-standalone-ship`
- North star: `waves-first-revenue` (unblocks at scaffold stage)
- Pattern origin: Rackwave PR #103 (parse-first, copy-as-code)
- Sister node: `fluxwave-rackwave-parity-import-workflow` (same pattern applied to UI)
- Unblocks: `waves-suite-liv-hat-rollout` (Mockwave needs Liv chat)

---

## Files Created

### Repository Root
- `package.json` — Workspace configuration
- `tsconfig.base.json` — Base TypeScript config
- `vite.config.ts` — Vite configuration
- `README.md` — Project overview
- `.gitignore` — Git ignore rules
- `SCOPING-MEMO-mockwave.md` — This document

### `app/` (Frontend)
- `index.html` — HTML entry point
- `src/main.tsx` — React entry point
- `src/App.tsx` — Main app component with import/export panels
- `src/index.css` — Base styles (suite theme)

### `engine/` (Core Logic)
- `package.json` — Engine package config
- `tsconfig.json` — Engine TypeScript config
- `src/index.ts` — Package exports
- `src/types.ts` — Type definitions (MockConfig, MockDefinition, etc.)
- `src/codeImport.ts` — Deterministic schema parser + patch/diff utilities
- `src/mockGenerator.ts` — Realistic mock data generator

---

## Verification

Run the scaffold:

```bash
cd mockwave
npm install
npm run dev
```

Open `http://localhost:3003`, paste a TypeScript interface, and verify:
- [ ] Schema is parsed (recognized fields appear)
- [ ] Mock data is generated
- [ ] UI matches the suite aesthetic
- [ ] Copy actions work
- [ ] Responsive at 390px width

---

*Generated by Mistral Vibe, Whisperers seat, 2026-09-06*
*Co-Authored-By: Mistral Vibe <vibe@mistral.ai>*
