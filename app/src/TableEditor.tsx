/**
 * Basewave table editor: the data module's first-screen feature. Load a sample data set
 * (or start blank), edit columns (name + Text/Number/Boolean/Date) and rows inline, and
 * copy the contract output (column schema with the rows) as code for Fluxwave.
 *
 * Mobile-first: columns are tappable chips (name + type) above a compact row grid that
 * fits a 390px screen with no sideways scroll; extra columns open in a row sheet. The
 * contract JSON stays behind the Copy button instead of printing under the table.
 */

import { useEffect, useRef, useState } from 'react';
import {
  addColumn,
  checkBasewaveTable,
  COLUMN_LABELS,
  COLUMN_TYPES,
  isInvalidCell,
  removeColumn,
  renameColumn,
  serializeTable,
  setCell,
  setColumnType,
  typedCellValue,
  blankTable,
  getSampleTable,
  SAMPLE_TABLES,
  type BasewaveTable,
  type ColumnType,
} from '../../engine/src';

/** How many columns each row card shows inline; the rest open in the row sheet. */
const INLINE_COLUMNS = 3;

interface Props {
  table: BasewaveTable | null;
  onLoad: (t: BasewaveTable) => void;
  onChange: (t: BasewaveTable) => void;
  onClear: () => void;
}

type SheetState =
  | { kind: 'column'; colId: string; focusName: boolean }
  | { kind: 'row'; rowIndex: number }
  | null;

function displayTyped(value: unknown, type: ColumnType): string {
  if (type === 'boolean') return value ? 'True' : 'False';
  return String(value);
}

interface CellProps {
  value: unknown;
  type: ColumnType;
  label: string;
  /** The kept raw value does not fit the column's current type (a type change never deletes it). */
  invalid: boolean;
  onCommit: (v: unknown) => void;
}

/** One inline-editable cell: a button that opens an input on click or Enter. The cell keeps the
 *  raw entered value; the shown text and the invalid flag are derived from it. */
function Cell({ value, type, label, invalid, onCommit }: CellProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const start = () => {
    setDraft(value === undefined || value === null ? '' : String(value));
    setEditing(true);
  };

  // Editing commits the raw entered text as the cell's new source of truth.
  const commit = () => {
    onCommit(draft === '' ? undefined : draft);
    setEditing(false);
  };

  if (!editing) {
    const typed = typedCellValue(type, value);
    const shown =
      typed !== undefined ? displayTyped(typed, type) : value === undefined || value === null ? '' : String(value);
    return (
      <button
        type="button"
        className={invalid ? 'cell cell-invalid' : 'cell'}
        aria-label={label}
        aria-invalid={invalid || undefined}
        title={invalid ? `${label}: ${shown} (not a valid ${COLUMN_LABELS[type]} value, kept as-is)` : `${label}: ${shown}`}
        onClick={start}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            start();
          }
        }}
      >
        {shown}
      </button>
    );
  }

  if (type === 'boolean') {
    const typed = typedCellValue(type, value);
    return (
      <select
        className="cell-input"
        aria-label={label}
        autoFocus
        value={typed === undefined ? '' : String(typed)}
        onChange={(e) => {
          onCommit(e.target.value === '' ? undefined : e.target.value);
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

/** Bottom sheet for one column: Rename, Type and Remove Column. */
function ColumnSheet({
  table,
  ci,
  focusName,
  onChange,
  onClose,
}: {
  table: BasewaveTable;
  ci: number;
  focusName: boolean;
  onChange: (t: BasewaveTable) => void;
  onClose: () => void;
}) {
  const col = table.columns[ci];
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Edit column ${col.name || ci + 1}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="sheet-title">Edit Column</h3>
        <label className="sheet-field">
          <span>Rename</span>
          <input
            className="col-name"
            autoFocus={focusName}
            value={col.name}
            aria-label="Column name"
            spellCheck={false}
            onChange={(e) => onChange(renameColumn(table, ci, e.target.value))}
          />
        </label>
        <label className="sheet-field">
          <span>Type</span>
          <select
            className="col-type"
            value={col.type}
            aria-label="Column type"
            onChange={(e) => onChange(setColumnType(table, ci, e.target.value as ColumnType))}
          >
            {COLUMN_TYPES.map((t) => (
              <option key={t} value={t}>
                {COLUMN_LABELS[t]}
              </option>
            ))}
          </select>
        </label>
        <div className="sheet-actions">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              onChange(removeColumn(table, ci));
              onClose();
            }}
          >
            Remove Column
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

/** Bottom sheet for one row: every column's cell editor, plus Remove Row. */
function RowSheet({
  table,
  ri,
  onChange,
  onRemoveRow,
  onClose,
}: {
  table: BasewaveTable;
  ri: number;
  onChange: (t: BasewaveTable) => void;
  onRemoveRow: (ri: number) => void;
  onClose: () => void;
}) {
  const row = table.rows[ri];
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={`Row ${ri + 1}`}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="sheet-title">Row {ri + 1}</h3>
        <div className="sheet-fields">
          {table.columns.map((col, ci) => (
            <div className="grid-cell" key={col.id}>
              <span className="grid-cell-label">
                {col.name || `Column ${ci + 1}`} ({COLUMN_LABELS[col.type]})
              </span>
              <Cell
                value={row[col.id]}
                type={col.type}
                label={`Row ${ri + 1}, ${col.name || `column ${ci + 1}`}`}
                invalid={isInvalidCell(row[col.id], col.type)}
                onCommit={(v) => onChange(setCell(table, ri, ci, v))}
              />
            </div>
          ))}
        </div>
        <div className="sheet-actions">
          <button
            type="button"
            className="btn btn-danger"
            onClick={() => {
              onRemoveRow(ri);
              onClose();
            }}
          >
            Remove Row
          </button>
          <button type="button" className="btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TableEditor({ table, onLoad, onChange, onClear }: Props) {
  const [copied, setCopied] = useState(false);
  const [sheet, setSheet] = useState<SheetState>(null);
  const chipRefs = useRef(new Map<string, HTMLButtonElement>());

  // Add Column scrolls the new chip into view; the column sheet then focuses its name.
  useEffect(() => {
    if (sheet?.kind === 'column' && sheet.focusName) {
      chipRefs.current.get(sheet.colId)?.scrollIntoView({ block: 'nearest', inline: 'end' });
    }
  }, [sheet]);

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
  // While any cell is invalid, the banner explains it and the copy stays disabled.
  const invalidCells = table.rows.reduce(
    (n, row) => n + table.columns.filter((col) => isInvalidCell(row[col.id], col.type)).length,
    0,
  );

  const addRow = () => onChange({ ...table, rows: [...table.rows, {}] });

  const removeRow = (ri: number) => onChange({ ...table, rows: table.rows.filter((_, i) => i !== ri) });

  // The new column's chip is scrolled into view and its sheet opens with the name focused.
  const handleAddColumn = () => {
    const next = addColumn(table);
    const added = next.columns[next.columns.length - 1];
    onChange(next);
    setSheet({ kind: 'column', colId: added.id, focusName: true });
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked; nothing is printed, so the banner state is the only fallback message
    }
  };

  const sheetColIndex = sheet?.kind === 'column' ? table.columns.findIndex((c) => c.id === sheet.colId) : -1;

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
        <button type="button" className="btn" onClick={addRow}>
          Add Row
        </button>
        <button type="button" className="btn" onClick={onClear}>
          Back
        </button>
      </div>

      {errors.length > 0 && (
        <div className="error" role="alert">
          {errors.map((e, i) => (
            <div key={`${i}-${e}`}>{e}</div>
          ))}
        </div>
      )}

      <div className="col-chips" role="group" aria-label="Columns">
        {table.columns.map((col, ci) => (
          <button
            key={col.id}
            type="button"
            className="col-chip"
            ref={(el) => {
              if (el) chipRefs.current.set(col.id, el);
              else chipRefs.current.delete(col.id);
            }}
            aria-label={`Column ${col.name || ci + 1}, ${COLUMN_LABELS[col.type]}. Tap to edit.`}
            onClick={() => setSheet({ kind: 'column', colId: col.id, focusName: false })}
          >
            <span className="col-chip-name">{col.name || `Column ${ci + 1}`}</span>
            <span className="col-chip-type">{COLUMN_LABELS[col.type]}</span>
          </button>
        ))}
        <button type="button" className="col-chip col-chip-add" onClick={handleAddColumn}>
          Add Column
        </button>
      </div>

      <div className="rows-grid">
        {table.rows.length === 0 && <p className="empty-rows">No rows yet. Use Add Row.</p>}
        {table.rows.map((row, ri) => {
          const inlineCols = table.columns.slice(0, INLINE_COLUMNS);
          const extraCols = table.columns.length - inlineCols.length;
          return (
            <div className="row-card" key={ri}>
              <div className="row-head">
                <span className="row-title">Row {ri + 1}</span>
                <button
                  type="button"
                  className="btn btn-sm"
                  aria-label={`Remove row ${ri + 1}`}
                  onClick={() => removeRow(ri)}
                >
                  Remove
                </button>
              </div>
              <div className="row-cells">
                {inlineCols.map((col, ci) => (
                  <div className="grid-cell" key={col.id}>
                    <span className="grid-cell-label">{col.name || `Column ${ci + 1}`}</span>
                    <Cell
                      value={row[col.id]}
                      type={col.type}
                      label={`Row ${ri + 1}, ${col.name || `column ${ci + 1}`}`}
                      invalid={isInvalidCell(row[col.id], col.type)}
                      onCommit={(v) => onChange(setCell(table, ri, ci, v))}
                    />
                  </div>
                ))}
              </div>
              {extraCols > 0 && (
                <button
                  type="button"
                  className="btn btn-sm row-more"
                  aria-label={`Row ${ri + 1}: all ${table.columns.length} fields`}
                  onClick={() => setSheet({ kind: 'row', rowIndex: ri })}
                >
                  All Fields ({table.columns.length})
                </button>
              )}
            </div>
          );
        })}
      </div>

      <p className="hint">
        Tap a column chip to rename it, change its type, or remove it. Tap a cell to edit it: Enter commits, Esc
        cancels.
      </p>

      <h3 className="output-heading">Contract Output</h3>
      {invalidCells > 0 && (
        <div className="error" role="alert">
          <div>
            {invalidCells} invalid cell{invalidCells === 1 ? '' : 's'}: fix each cell (or switch its column type)
            before the contract output can be copied.
          </div>
        </div>
      )}
      <div className="copy-actions">
        <button type="button" className="btn" onClick={handleCopy} disabled={errors.length > 0}>
          {copied ? 'Copied' : 'Copy Contract Output'}
        </button>
      </div>

      {sheet?.kind === 'column' && sheetColIndex >= 0 && (
        <ColumnSheet
          table={table}
          ci={sheetColIndex}
          focusName={sheet.focusName}
          onChange={onChange}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet?.kind === 'row' && sheet.rowIndex < table.rows.length && (
        <RowSheet
          table={table}
          ri={sheet.rowIndex}
          onChange={onChange}
          onRemoveRow={removeRow}
          onClose={() => setSheet(null)}
        />
      )}
    </section>
  );
}
