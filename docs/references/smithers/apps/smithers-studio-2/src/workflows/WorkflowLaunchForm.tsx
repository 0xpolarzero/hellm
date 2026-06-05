import { useMemo } from "react";
import type { WorkflowLaunchField } from "./workflowsApi";
import { launchFieldKind, launchFieldRawValue } from "./launchFieldLogic";

/**
 * The launch arguments form. When the workflow declares typed launch fields we
 * render one control per field (text / number / boolean / JSON); otherwise we
 * fall back to a single freeform JSON textarea. Field-level validation errors
 * render inline beneath their control.
 */
export function WorkflowLaunchForm({
  fields,
  values,
  errors,
  freeform,
  onFieldChange,
  onFreeformChange,
}: {
  fields: WorkflowLaunchField[];
  values: Record<string, string>;
  errors: Record<string, string>;
  freeform: string;
  onFieldChange: (key: string, value: string) => void;
  onFreeformChange: (value: string) => void;
}) {
  const hasFields = useMemo(() => fields.length > 0, [fields]);

  if (!hasFields) {
    return (
      <div className="wf-launch-form" data-testid="wf.launch.form">
        <label className="wf-field">
          <span className="wf-field-label">Input (JSON)</span>
          <textarea
            className="wf-field-textarea"
            data-testid="wf.launch.freeform"
            spellCheck={false}
            value={freeform}
            placeholder="{}"
            onChange={(event) => onFreeformChange(event.target.value)}
          />
        </label>
      </div>
    );
  }

  return (
    <div className="wf-launch-form" data-testid="wf.launch.form">
      {fields.map((field) => {
        const kind = launchFieldKind(field);
        const raw = launchFieldRawValue(field, values);
        const error = errors[field.key];
        const inputId = `wf-field-${field.key}`;
        const errorId = error ? `${inputId}-error` : undefined;
        return (
          <div className="wf-field" key={field.key}>
            <label className="wf-field-label" htmlFor={inputId}>
              {field.name}
              {field.required ? <span className="wf-field-required"> *</span> : null}
              <span className="wf-field-kind">{kind}</span>
            </label>
            {kind === "boolean" ? (
              <select
                id={inputId}
                className="wf-field-input"
                data-testid={`wf.launch.field.${field.key}`}
                aria-invalid={error ? true : undefined}
                aria-describedby={errorId}
                value={["true", "1", "yes", "on"].includes(raw.trim().toLowerCase()) ? "true" : "false"}
                onChange={(event) => onFieldChange(field.key, event.target.value)}
              >
                <option value="false">false</option>
                <option value="true">true</option>
              </select>
            ) : kind === "object" || kind === "array" || kind === "json" ? (
              <textarea
                id={inputId}
                className="wf-field-textarea"
                data-testid={`wf.launch.field.${field.key}`}
                aria-invalid={error ? true : undefined}
                aria-describedby={errorId}
                spellCheck={false}
                value={raw}
                placeholder={kind === "array" ? "[]" : kind === "object" ? "{}" : "JSON value"}
                onChange={(event) => onFieldChange(field.key, event.target.value)}
              />
            ) : (
              <input
                id={inputId}
                className="wf-field-input"
                data-testid={`wf.launch.field.${field.key}`}
                aria-invalid={error ? true : undefined}
                aria-describedby={errorId}
                type={kind === "number" ? "number" : "text"}
                value={raw}
                onChange={(event) => onFieldChange(field.key, event.target.value)}
              />
            )}
            {error ? (
              <span
                id={errorId}
                className="wf-field-error"
                data-testid={`wf.launch.field-error.${field.key}`}
              >
                {error}
              </span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
