/**
 * Basewave table editor: the data module's first-screen feature. Load a sample data set
 * (or start blank), edit columns (name + Text/Number/Boolean/Date) and rows inline, and
 * copy the contract output (column schema with the rows) as code for Fluxwave.
 *
 * Mobile-first: the table scrolls inside its own container, never the page.
 */

import { useState } from 'react';
import {
  addColumn,
  checkBasewaveTable,
  coerceValue,
  COLUMN_LABELS,
  COLUMN_TYPES,
  removeColumn,
  renameColumn,
  serializeTable,
  setCell,
  setColumnType,
  blankTable,
  getSampleTable,
  SAMPLE_TABLES,
  type BasewaveTable,
  type ColumnType,
} from '../../engine/src';

interface Props {
  table: BasewaveTable | null;
  onLoad: (t: BasewaveTable) => void;
  onChange: (t: BasewaveTable) => void;
  onClear: () => void;
}

function displayValue(value: unknown, type: ColumnType): string {
  if (value === undefined || value === null) return '';
  if (type === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

interface CellProps {
  value: unknown;
  type: ColumnType;
  label: string;
  onCommit: (v: unknown) => void;
}

/** One inline-editable cell: a button that opens an input on click or Enter. */
function Cell({ value, type, label, onCommit }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const start = () => {
    setDraft(value === undefined || value === null ? '' : String(value));
    setEditing(true);
  };

  const commit = () => {
    onCommit(coerceValue(type, draft));
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        className="cell"
        aria-label={label}
        title={`${label}: ${displayValue(value, type)}`}
        onClick={start}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            start();
          }
        }}
      >
        {displayValue(value, type)}
      </button>
    );
  }

  if (type === 'boolean') {
    return (
      <select
        className="cell-input"
        aria-label={label}
        autoFocus
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => {
          onCommit(e.target.value === '' ? undefined : e.target.value === 'true');
          setEditing(false);
        }}
        onBlur={() => setEditing(false)}
      >
        <option value="">Blank</option>
        <option value="true">True</option>
        <option value="false">False</option>
      </select>
    );
  }

  const inputType = type === 'number' ? 'number' : type === 'date' ? 'date' : 'text';
  return (
    <input
      className="cell-input"
      aria-label={label}
      autoFocus
      type={inputType}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setEditing(false);
        }
      }}
    />
  );
}

export default function TableEditor({ table, onLoad, onChange, onClear }: Props) {
  const [copied, setCopied] = useState(false);

  if (!table) {
    return (
      <section className="import-panel table-panel">
        <h2>Table Editor</h2>
        <p>No table loaded. Load a sample data set or start a blank table, then edit it here.</p>
        <div className="sample-grid">
          {SAMPLE_TABLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn sample-btn"
              onClick={() => onLoad(getSampleTable(s.id) ?? blankTable())}
            >
              <span className="sample-label">{s.label}</span>
              <span className="sample-desc">{s.description}</span>
            </button>
          ))}
        </div>
        <button type="button" className="primary-btn" onClick={() => onLoad(blankTable())}>
          Start Blank Table
        </button>
      </section>
    );
  }

  const errors = checkBasewaveTable(table);
  const code = serializeTable(table);

  const addRow = () => onChange({ ...table, rows: [...table.rows, {}] });

  const removeRow = (ri: number) => onChange({ ...table, rows: table.rows.filter((_, i) => i !== ri) });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; the output stays selectable for a manual copy
    }
  };

  return (
    <section className="import-panel table-panel">
      <h2>Table Editor</h2>
      <div className="table-toolbar">
        <label className="table-name">
          <span>Table Name</span>
          <input
            value={table.name}
            onChange={(e) => onChange({ ...table, name: e.target.value })}
            aria-label="Table name"
            spellCheck={false}
          />
        </label>
        <button type="button" className="btn" onClick={() => onChange(addColumn(table))}>
          Add Column
        </button>
        <button type="button" className="btn" onClick={addRow}>
          Add Row
        </button>
        <button type="button" className="btn" onClick={onClear}>
          Close Table
        </button>
      </div>

      {errors.length > 0 && (
        <div className="error" role="alert">
          {errors.map((e, i) => (
            <div key={`${i}-${e}`}>{e}</div>
          ))}
        </div>
      )}

      <div className="table-scroll">
        <table className="data-table">
          <thead>
            <tr>
              {table.columns.map((col, ci) => (
                <th key={col.id} scope="col">
                  <div className="th-inner">
                    <input
                      className="col-name"
                      value={col.name}
                      aria-label={`Column ${ci + 1} name`}
                      spellCheck={false}
                      onChange={(e) => onChange(renameColumn(table, ci, e.target.value))}
                    />
                    <select
                      className="col-type"
                      value={col.type}
                      aria-label={`Column ${ci + 1} type`}
                      onChange={(e) => onChange(setColumnType(table, ci, e.target.value as ColumnType))}
                    >
                      {COLUMN_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {COLUMN_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn btn-sm"
                      aria-label={`Remove column ${col.name || ci + 1}`}
                      onClick={() => onChange(removeColumn(table, ci))}
                    >
                      Remove
                    </button>
                  </div>
                </th>
              ))}
              <th className="row-actions-head">
                <span className="visually-hidden">Row Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {table.rows.length === 0 && (
              <tr>
                <td className="empty-rows" colSpan={Math.max(table.columns.length, 1) + 1}>
                  No rows yet. Use Add Row.
                </td>
              </tr>
            )}
            {table.rows.map((row, ri) => (
              <tr key={ri}>
                {table.columns.map((col, ci) => (
                  <td key={col.id}>
                    <Cell
                      value={row[col.id]}
                      type={col.type}
                      label={`Row ${ri + 1}, ${col.name || `column ${ci + 1}`}`}
                      onCommit={(v) => onChange(setCell(table, ri, ci, v))}
                    />
                  </td>
                ))}
                <td className="row-actions">
                  <button
                    type="button"
                    className="btn btn-sm"
                    aria-label={`Remove row ${ri + 1}`}
                    onClick={() => removeRow(ri)}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="hint">
        Click a cell, or focus it and press Enter, to edit. Enter commits, Esc cancels, Tab moves to the next
        control.
      </p>

      <h3 className="output-heading">Contract Output</h3>
      <pre className="code-output">{code}</pre>
      <div className="copy-actions">
        <button type="button" className="btn" onClick={handleCopy} disabled={errors.length > 0}>
          {copied ? 'Copied' : 'Copy Table Code'}
        </button>
      </div>
    </section>
  );
}
