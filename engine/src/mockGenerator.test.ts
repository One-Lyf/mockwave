/**
 * Typed mock output (UI 1127, product logic): Date fields compile against the pasted
 * interface, the row count is respected, the emitted TypeScript type-checks with tsc,
 * and field-aware values follow the parent type name (a Recipe title is a dish).
 */

import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseSchema } from './codeImport';
import { DEFAULT_ROWS, MAX_ROWS, generateMockRows, mulberry32, toMockCode, toTypeScriptLiteral } from './mockGenerator';
import { classifyField, DOMAIN_TITLES } from './fieldHints';

const RECIPE_TS = `interface Recipe {
  id: string;
  title: string;
  minutes: number;
  vegetarian: boolean;
  createdAt: Date;
}
`;

const recipeImport = () => {
  const imp = parseSchema(RECIPE_TS);
  expect(imp).not.toBeNull();
  expect(imp!.config.root.type).toBe('object');
  expect(imp!.config.name).toBe('Recipe');
  return imp!;
};

describe('typed output: Date fields', () => {
  it('emit new Date("...") in TypeScript output and round-trip to real Dates, while JSON stays an ISO string', () => {
    const imp = recipeImport();
    const { data } = generateMockRows(imp.config, { seed: 'dates', rows: 4 });
    const rows = data as Record<string, unknown>[];
    expect(rows).toHaveLength(4);

    // Raw generated data keeps ISO strings (the JSON output path is unchanged)
    for (const row of rows) expect(typeof row.createdAt).toBe('string');
    expect(JSON.stringify(data)).toContain('"createdAt":"');

    // The TS literal wraps each date field in new Date(...)
    const code = toMockCode('Recipe', imp.config.root, data, true);
    const exprs = code.match(/new Date\("[^"]+"\)/g) ?? [];
    expect(exprs.length).toBe(rows.length);
    for (const expr of exprs) {
      const value: unknown = new Function(`return (${expr});`)();
      expect(value).toBeInstanceOf(Date);
      expect(Number.isNaN((value as Date).getTime())).toBe(false);
    }
  });

  it('serializes nested date fields (arrays and objects) as new Date too', () => {
    const imp = parseSchema(`interface Event {
  name: string;
  startsAt: Date;
  tags: string[];
  history: { at: Date; note: string }[];
}
`);
    expect(imp).not.toBeNull();
    const { data } = generateMockRows(imp!.config, { seed: 'nested', rows: 2 });
    const code = toMockCode('Event', imp!.config.root, data, true);
    expect(code).toContain('"startsAt": new Date("');
    expect(code).toContain('"at": new Date("');
    expect(code).not.toMatch(/"(startsAt|at)": "/);
  });
});

describe('typed output: row count', () => {
  it('is respected: default is 5, explicit counts apply, and it clamps to 1..MAX_ROWS', () => {
    const imp = recipeImport();
    expect((generateMockRows(imp.config, { seed: 1 }).data as unknown[])).toHaveLength(DEFAULT_ROWS);
    expect(DEFAULT_ROWS).toBe(5);
    expect((generateMockRows(imp.config, { seed: 1, rows: 7 }).data as unknown[])).toHaveLength(7);
    expect((generateMockRows(imp.config, { seed: 1, rows: 1 }).data as unknown[])).toHaveLength(1);
    expect((generateMockRows(imp.config, { seed: 1, rows: 0 }).data as unknown[])).toHaveLength(1);
    expect((generateMockRows(imp.config, { seed: 1, rows: 9999 }).data as unknown[])).toHaveLength(MAX_ROWS);
  });

  it('emits an exported array typed Name[] for an object root', () => {
    const imp = recipeImport();
    const { data } = generateMockRows(imp.config, { seed: 'arr', rows: 3 });
    const code = toMockCode('Recipe', imp.config.root, data, true);
    expect(code).toMatch(/^export const mockRecipe: Recipe\[\] = \[\n/);
    expect(code).toMatch(/\n\];\n$/);
    // one object literal per row
    expect(code.match(/\n  \{\n/g)).toHaveLength(3);
  });
});

describe('typed output: the emitted TypeScript type-checks', () => {
  it('compiles the Recipe sample snippet against the pasted interface, and the old string output does not', () => {
    const imp = recipeImport();
    const { data } = generateMockRows(imp.config, { seed: 'recipe-ts', rows: 5 });
    const snippet = toMockCode('Recipe', imp.config.root, data, true);
    expect(snippet).toContain('export const mockRecipe: Recipe[] = [');
    expect(snippet).toContain('new Date("');

    // Compile in-process with the repo's own typescript (types: [] keeps node_modules
    // @types out of the program, so only the snippet is checked)
    const require = createRequire(import.meta.url);
    const ts = require('typescript') as typeof import('typescript');
    const dir = mkdtempSync(join(tmpdir(), 'basewave-typed-output-'));
    const compile = (file: string): string[] => {
      const program = ts.createProgram([file], {
        noEmit: true,
        strict: true,
        target: ts.ScriptTarget.ES2020,
        lib: ['lib.es2020.d.ts'],
        skipLibCheck: true,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        types: [],
      });
      return ts.getPreEmitDiagnostics(program).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
    };

    const good = join(dir, 'check.ts');
    writeFileSync(good, `${RECIPE_TS}\n${snippet}`);
    expect(compile(good)).toEqual([]);

    // Negative control: a plain ISO string where the interface declares Date must fail,
    // which proves the check above has teeth
    const bad = join(dir, 'bad.ts');
    writeFileSync(
      bad,
      `${RECIPE_TS}\nexport const mockRecipe: Recipe = { id: 'r_1', title: 'X', minutes: 1, vegetarian: false, createdAt: '2026-01-01T00:00:00.000Z' };\n`,
    );
    const badDiags = compile(bad);
    expect(badDiags.some((m) => m.includes("Type 'string' is not assignable to type 'Date'"))).toBe(true);
  }, 240000);
});

describe('typed output: field-aware values', () => {
  it('classifies a Recipe title from the parent type name and a recipeName field from its own words', () => {
    const dishes = DOMAIN_TITLES.recipe;
    const byParent = classifyField('title', 'Recipe');
    expect(byParent?.string).toBeDefined();
    for (let i = 0; i < 10; i++) expect(dishes).toContain(byParent!.string!(mulberry32(i + 1)));

    const byField = classifyField('recipeName');
    expect(byField?.string).toBeDefined();
    for (let i = 0; i < 10; i++) expect(dishes).toContain(byField!.string!(mulberry32(i + 11)));

    // No domain context: still a generic title, not a dish
    const generic = classifyField('title');
    expect(generic?.string).toBeDefined();
    expect(dishes).not.toContain(generic!.string!(mulberry32(1)));
  });

  it('generates dish titles for every row of the Recipe sample', () => {
    const imp = recipeImport();
    const { data } = generateMockRows(imp.config, { seed: 'titles', rows: 5 });
    for (const row of data as Record<string, unknown>[]) {
      expect(DOMAIN_TITLES.recipe).toContain(row.title);
    }
  });

  it('keeps person names person names inside a domain type (Book.authorName is not a book title)', () => {
    const hint = classifyField('authorName', 'Book');
    expect(hint?.person).toBeDefined();
    expect(hint?.string).toBeDefined();
    const value = hint!.string!(mulberry32(7));
    expect(DOMAIN_TITLES.book).not.toContain(value);
    expect(value).toMatch(/^[A-Z][a-z]+ [A-Z][a-z]+$/);
  });
});

describe('toTypeScriptLiteral shape', () => {
  it('emits plain JSON for non-date primitives and handles empty containers', () => {
    const imp = recipeImport();
    const { data } = generateMockRows(imp.config, { seed: 'shape', rows: 1 });
    const literal = toTypeScriptLiteral(imp.config.root, (data as unknown[])[0]);
    expect(literal).toMatch(/^\{\n {2}"id": "[0-9a-f-]{36}",\n/);
    expect(literal).toContain('"minutes": ');
    expect(literal).toContain('"vegetarian": ');
    expect(literal).not.toContain('undefined');
    expect(toTypeScriptLiteral({ type: 'array', itemType: { type: 'string' } }, [])).toBe('[]');
    expect(toTypeScriptLiteral({ type: 'object', properties: {} }, {})).toBe('{}');
  });
});
