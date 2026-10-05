import { useState, type FormEvent } from 'react';
import { formFields, readForm, type FormInput, type FormOptions } from '../../../engine/src';
import type { EntityDef, Row } from '../../../engine/src';

const label = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/([A-Z])/g, ' $1');
const title = (s: string) => s.replace(/\b[a-z]/g, (c) => c.toUpperCase());

export interface RefChoice {
  id: string;
  label: string;
}

interface Props {
  entity: EntityDef;
  heading: string;
  saveLabel: string;
  /** Existing row when editing. */
  row?: Row;
  /** Starting text for fields not on the row (a new date, say). */
  defaults?: FormInput;
  /** Choices for each ref field, keyed by field name. */
  choices?: Record<string, RefChoice[]>;
  options?: FormOptions;
  onSave: (values: Record<string, unknown>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onCancel: () => void;
}

function initial(entity: EntityDef, row: Row | undefined, defaults: FormInput | undefined): FormInput {
  const out: FormInput = { ...defaults };
  for (const f of entity.fields) {
    const v = row?.[f.name];
    if (v === undefined || v === null) continue;
    out[f.name] = f.type === 'boolean' ? v === true : String(v);
  }
  return out;
}

/** A schema-driven form: one input per field, required unless the Entity says optional. */
export default function EntityForm({ entity, heading, saveLabel, row, defaults, choices = {}, options, onSave, onDelete, onCancel }: Props) {
  const fields = formFields(entity, options);
  const [input, setInput] = useState<FormInput>(() => initial(entity, row, defaults));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const set = (name: string, v: string | boolean) => setInput((p) => ({ ...p, [name]: v }));

  async function run(action: () => Promise<void>) {
    setBusy(true);
    setFailure('');
    try {
      await action();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'Something Went Wrong');
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const result = readForm(fields, input);
    setErrors(result.errors);
    if (Object.keys(result.errors).length) return;
    void run(() => onSave(result.values));
  }

  return (
    <div className="kd-layer" role="dialog" aria-modal="true" aria-label={heading}>
      <button type="button" className="kd-scrim" aria-label="Close" tabIndex={-1} onClick={onCancel} />
      <form className="kd-sheet" onSubmit={submit} noValidate>
        <h2>{heading}</h2>
        {fields.map(({ field, required }) => {
          const id = `kd-${entity.name}-${field.name}`;
          const text = typeof input[field.name] === 'string' ? (input[field.name] as string) : '';
          const name = title(label(field.name));
          return (
            <div className="kd-fld" key={field.name}>
              {field.type === 'boolean' ? (
                <label className="kd-check" htmlFor={id}>
                  <input id={id} type="checkbox" checked={input[field.name] === true} onChange={(e) => set(field.name, e.target.checked)} />
                  {name}
                </label>
              ) : (
                <>
                  <label htmlFor={id}>{required ? name : `${name} (Optional)`}</label>
                  {field.type === 'enum' || field.type === 'ref' ? (
                    <select id={id} value={text} onChange={(e) => set(field.name, e.target.value)} aria-invalid={!!errors[field.name]}>
                      <option value="">Choose</option>
                      {field.type === 'enum'
                        ? field.enum!.map((v) => <option key={v} value={v}>{title(v)}</option>)
                        : (choices[field.name] ?? []).map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  ) : (
                    <input
                      id={id}
                      type={field.type === 'number' ? 'text' : field.type === 'date' ? 'datetime-local' : 'text'}
                      inputMode={field.type === 'number' ? 'decimal' : undefined}
                      value={text}
                      onChange={(e) => set(field.name, e.target.value)}
                      aria-invalid={!!errors[field.name]}
                    />
                  )}
                  {field.type === 'ref' && !(choices[field.name] ?? []).length && (
                    <p className="kd-hint">No {title(label(field.to!))}s Yet. Add One In The {title(label(field.to!))}s Tab.</p>
                  )}
                </>
              )}
              {errors[field.name] && <p className="kd-err" role="alert">{errors[field.name]}</p>}
            </div>
          );
        })}
        {failure && <p className="kd-err kd-fail" role="alert">{failure}</p>}
        <div className="kd-actions">
          <button type="button" className="kd-btn ghost" onClick={onCancel} disabled={busy}>Cancel</button>
          <button type="submit" className="kd-btn" disabled={busy}>{saveLabel}</button>
        </div>
        {onDelete && (
          <button
            type="button"
            className="kd-btn ghost kd-danger"
            disabled={busy}
            onClick={() => (confirming ? void run(onDelete) : setConfirming(true))}
          >
            {confirming ? 'Tap Again To Delete' : 'Delete'}
          </button>
        )}
      </form>
    </div>
  );
}
