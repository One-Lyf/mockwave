/**
 * Mockwave - Data Mocking Wave
 *
 * The third app in WaveRider (Rackwave: audio, Fluxwave: UI, Mockwave: data).
 * Pattern: copy-as-code for generating realistic mock data structures.
 *
 * User flow:
 * 1. Paste or import your real data schema/source
 * 2. Configure mocking rules (field types, distributions, relationships)
 * 3. Generate mock data
 * 4. Copy the generated mock code to use in your tests/development
 *
 * Parsing and generation run through the deterministic engine (engine/src):
 * parseSchema() detects the format, generateMock() fills it with mock values.
 */

import { Component, useState, type ReactNode } from 'react';
import { generateMock, parseSchema } from '../../engine/src';
import type { SchemaImport, SchemaType } from '../../engine/src';
import ThemeToggle from './ThemeToggle';

import './index.css';

const FORMAT_LABELS: Record<SchemaType, string> = {
  'typescript-interface': 'TypeScript Interface',
  'typescript-type': 'TypeScript Type',
  'json-schema': 'JSON Schema',
  'json': 'Sample JSON',
  'zod-schema': 'Zod Schema',
  'yup-schema': 'Yup Schema',
  'graphql-type': 'GraphQL SDL',
};

/** How many unrecognized field names to list before summarizing the rest. */
const NOTE_LIMIT = 6;

interface Result {
  code: string;
  format: string;
  name: string;
  unrecognized: string[];
}

/** Keeps a render failure in the result panel from blanking the whole app. Remounted
 *  (via `key`) for each new result, so the next Generate gets a fresh chance. */
class ResultBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="export-panel">
          <h2>Generated Mock</h2>
          <div className="error" role="alert">
            Mockwave generated mock data but could not display it. Try a smaller or simpler schema.
          </div>
        </section>
      );
    }
    return this.props.children;
  }
}

/** Render generated data as code in the shape of the pasted schema. */
function toCode(imp: SchemaImport, data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  if (imp.schemaType === 'typescript-interface' || imp.schemaType === 'typescript-type') {
    const name = imp.config.name;
    return `export const mock${name}: ${name} = ${json};\n`;
  }
  return `${json}\n`;
}

export default function App() {
  const [schemaInput, setSchemaInput] = useState<string>('');
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<boolean>(false);
  const [runId, setRunId] = useState<number>(0);

  const handleGenerateMock = () => {
    setError(null);
    setCopied(false);
    if (!schemaInput.trim()) {
      setError('Please enter a schema or paste your data source');
      setResult(null);
      return;
    }

    const unreadable =
      'Mockwave could not read this schema. Paste a TypeScript interface or type, a JSON Schema, sample JSON, or a GraphQL type.';
    // Parsing can throw on hostile input (deep nesting); it must surface as an error, never a blank app
    let imp: SchemaImport | null;
    try {
      imp = parseSchema(schemaInput);
    } catch {
      imp = null;
    }
    if (!imp) {
      setResult(null);
      setError(unreadable);
      return;
    }

    try {
      const { data } = generateMock(imp.config);
      setResult({
        code: toCode(imp, data),
        format: FORMAT_LABELS[imp.schemaType] ?? 'Schema',
        name: String(imp.config.name),
        unrecognized: imp.unrecognized.map(String),
      });
      setRunId((n) => n + 1);
    } catch {
      setResult(null);
      setError('Mockwave read this schema but could not generate mock data for it.');
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setError('Copy failed. Select the code and copy it manually.');
    }
  };

  const unrecognizedNote = (fields: string[]) => {
    const shown = fields.slice(0, NOTE_LIMIT).join(', ');
    const more = fields.length > NOTE_LIMIT ? ` and ${fields.length - NOTE_LIMIT} more` : '';
    const noun = fields.length === 1 ? 'field was' : 'fields were';
    return `${fields.length} ${noun} not recognized and left out: ${shown}${more}.`;
  };

  return (
    <div className="mockwave-app">
      <header className="mockwave-header">
        <div className="header-bar">
          <ThemeToggle />
        </div>
        <h1>Mockwave</h1>
        <p className="tagline">Generate Realistic Mock Data With Copy-As-Code</p>
      </header>

      <main className="mockwave-main">
        <section className="import-panel">
          <h2>Import Your Schema</h2>
          <p>
            Paste your data schema, TypeScript interface, or JSON structure below.
            Mockwave will generate realistic mock data that matches your structure.
          </p>

          <textarea
            value={schemaInput}
            onChange={(e) => setSchemaInput(e.target.value)}
            aria-label="Schema"
            spellCheck={false}
            placeholder={`Paste your schema here, e.g.:

// TypeScript interface
interface User {
  id: string;
  name: string;
  email: string;
  age: number;
  isActive: boolean;
  createdAt: Date;
}

// Or JSON Schema
{
  "type": "object",
  "properties": {
    "id": { "type": "string" },
    "name": { "type": "string" }
  }
}`}
            rows={12}
          />

          {error && <div className="error" role="alert">{error}</div>}

          <button
            className="primary-btn"
            onClick={handleGenerateMock}
            disabled={!schemaInput.trim()}
          >
            Generate Mock Data
          </button>
        </section>

        {result && (
          <ResultBoundary key={runId}>
            <section className="export-panel">
              <h2>Generated Mock</h2>
              <p className="detected">
                Detected {result.format}: <code>{result.name}</code>
              </p>
              {result.unrecognized.length > 0 && (
                <p className="note">{unrecognizedNote(result.unrecognized)}</p>
              )}
              <div className="tabs">
                <button className="tab active">Code</button>
                <button className="tab" disabled title="Coming Soon">Diff</button>
              </div>
              <pre className="code-output">{result.code}</pre>
              <div className="copy-actions">
                <button className="btn" onClick={handleCopy}>
                  {copied ? 'Copied' : 'Copy Mock Code'}
                </button>
                <button className="btn" disabled title="Coming Soon">
                  Copy Diff
                </button>
              </div>
            </section>
          </ResultBoundary>
        )}
      </main>

      <footer className="mockwave-footer">
        <p>WaveRider: Data Mocking for Modern Development</p>
      </footer>
    </div>
  );
}
