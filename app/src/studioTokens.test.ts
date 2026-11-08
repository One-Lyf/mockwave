import { describe, expect, it } from 'vitest';
import { generateMock, parseSchema } from '../../engine/src';
import { SCHEMA_EXAMPLES } from './App';
import css from './studio-tokens.css?raw';

// No Node imports: the root tsconfig has no Node types, so the file is read with Vite's ?raw and hashed
// with Web Crypto.
const sha256 = async (text: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

// The same file ships byte-identical in waverider, fluxwave and mockwave so the three
// modules read as one product. Changing it means changing it in all three.
const STUDIO_TOKENS_SHA256 = '96818c6607877d95cabd14492166dadbb409af3786da5fb37fe30943be861fff';

describe('Studio Dark tokens', () => {
  it('matches the shared token file', async () => {
    expect(await sha256(css)).toBe(STUDIO_TOKENS_SHA256);
  });

  it('defines light, dark and the OS fallback', () => {
    expect(css).toContain(':root {');
    expect(css).toContain(':root[data-theme="dark"]');
    expect(css).toContain('prefers-color-scheme: dark');
  });
});

describe('import examples', () => {
  it.each(SCHEMA_EXAMPLES.map((e) => [e.label, e.text] as const))('%s example parses to tables', (_label, text) => {
    const imp = parseSchema(text);
    expect(imp).not.toBeNull();
    expect(imp!.unrecognized).toEqual([]);
    const { data } = generateMock(imp!.config);
    expect(Object.keys(data as object).length).toBeGreaterThan(0);
  });

  it('has unique ids and no em dashes', () => {
    const ids = SCHEMA_EXAMPLES.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(SCHEMA_EXAMPLES)).not.toContain('—');
  });
});
