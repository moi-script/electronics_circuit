"use client";

import { useState } from "react";
import { isValidReference } from "@/model/refs";
import { parseSi } from "@/model/si";
import { useEditor } from "@/model/store";
import { partMap } from "@/model/wiring";

/**
 * Text field that validates on commit (Enter or blur) and shows an inline error.
 *
 * Local `value` mirrors `props.initial` (the store's current value) while the
 * user is not mid-edit. If `props.initial` changes for reasons other than this
 * field's own commit -- an undo/redo, or another update to the same param --
 * the field must pick that up rather than keep showing what it last committed;
 * otherwise a later blur with no further typing would re-send stale data and
 * clobber the newer value (breaking undo). We detect that by comparing
 * `props.initial` against the last value we synced from during render, React's
 * documented pattern for resetting state in response to a prop change without
 * an extra effect/render flash.
 */
function Field(props: {
  label: string;
  unit?: string;
  initial: string;
  validate: (value: string) => string | null;
  onCommit: (value: string) => void;
}) {
  const [value, setValue] = useState(props.initial);
  const [syncedInitial, setSyncedInitial] = useState(props.initial);
  const [error, setError] = useState<string | null>(null);
  if (props.initial !== syncedInitial) {
    setSyncedInitial(props.initial);
    setValue(props.initial);
    setError(null);
  }
  const id = `field-${props.label.replace(/\s+/g, "-").toLowerCase()}`;
  const commit = () => {
    const problem = props.validate(value);
    setError(problem);
    if (!problem && value !== props.initial) props.onCommit(value);
  };
  return (
    <div className="border-b border-line py-2">
      <label htmlFor={id} className="mb-1 block text-muted">{props.label}</label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === "Enter") commit(); }}
          className={`min-w-0 flex-1 rounded border bg-bg px-2 py-1 text-text focus:outline-none ${
            error ? "border-error" : "border-line focus:border-accent"
          }`}
        />
        {props.unit && <span className="text-muted">{props.unit}</span>}
      </div>
      {error && <div role="alert" className="mt-1 text-error">{error}</div>}
    </div>
  );
}

function ChoiceField(props: {
  label: string;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}) {
  const id = `field-${props.label.replace(/\s+/g, "-").toLowerCase()}`;
  return (
    <div className="border-b border-line py-2">
      <label htmlFor={id} className="mb-1 block text-muted">{props.label}</label>
      <select
        id={id}
        value={props.value}
        onChange={(e) => props.onChange(e.target.value)}
        className="w-full rounded border border-line bg-bg px-2 py-1 text-text focus:border-accent focus:outline-none"
      >
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </div>
  );
}

const panelButton = "rounded border border-line px-2 py-1 text-text hover:border-accent";

export default function PropertiesPanel() {
  const selection = useEditor((s) => s.selection);
  const project = useEditor((s) => s.project);
  const library = useEditor((s) => s.library);
  const { rotateSelected, mirrorSelected, deleteSelected, setParam, setReference } = useEditor((s) => s);

  if (!selection) {
    return (
      <aside className="w-64 shrink-0 border-l border-line bg-panel p-3 text-muted">Nothing selected</aside>
    );
  }

  if (selection.kind === "wire") {
    return (
      <aside className="w-64 shrink-0 border-l border-line bg-panel p-3">
        <div className="mb-3 text-muted">WIRE · {selection.uid}</div>
        <button className={panelButton} onClick={deleteSelected}>Delete</button>
      </aside>
    );
  }

  const component = project.components.find((c) => c.uid === selection.uid);
  const part = component && partMap(library).get(component.part);
  if (!component || !part) return null;

  return (
    <aside key={component.uid} className="w-64 shrink-0 overflow-y-auto border-l border-line bg-panel p-3">
      <div className="mb-1 text-[11px] uppercase tracking-wide text-muted">{part.manifest.category}</div>
      <div className="mb-2 text-text">{part.manifest.name}</div>
      <Field
        label="Reference"
        initial={component.ref}
        validate={(v) => (isValidReference(v) ? null : "Use a letter followed by letters, digits or _")}
        onCommit={(v) => setReference(component.uid, v)}
      />
      {part.manifest.params.map((param) =>
        param.type === "choice" ? (
          <ChoiceField
            key={param.key}
            label={param.label}
            value={component.params[param.key] ?? param.default}
            options={param.options ?? []}
            onChange={(v) => setParam(component.uid, param.key, v)}
          />
        ) : (
          <Field
            key={param.key}
            label={param.label}
            unit={param.unit}
            initial={component.params[param.key] ?? param.default}
            validate={(v) => {
              if (param.type === "text") return null;
              const parsed = parseSi(v);
              return parsed.ok ? null : parsed.error;
            }}
            onCommit={(v) => setParam(component.uid, param.key, v)}
          />
        ),
      )}
      <div className="mt-3 text-muted">Rotation {component.rot}°{component.mirror ? " · mirrored" : ""}</div>
      <div className="mt-2 flex gap-2">
        <button className={panelButton} onClick={rotateSelected}>Rotate</button>
        <button className={panelButton} onClick={mirrorSelected}>Mirror</button>
        <button className={panelButton} onClick={deleteSelected}>Delete</button>
      </div>
    </aside>
  );
}
