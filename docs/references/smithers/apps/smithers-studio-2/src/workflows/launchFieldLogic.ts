import type { WorkflowLaunchField } from "./workflowsApi";

/**
 * Launch fields declare a loose `type` string; we normalize it to one of these
 * editor kinds to decide how to render the control and how to coerce the typed
 * text into the JSON value sent to launchRun. Ported from the original app's
 * WorkflowsView so launch parity is preserved.
 */
export type LaunchFieldKind = "string" | "number" | "boolean" | "object" | "array" | "json";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function launchFieldKind(field: WorkflowLaunchField): LaunchFieldKind {
  const type = field.type?.trim().toLowerCase();
  if (["number", "integer", "int", "float", "double"].includes(type ?? "")) return "number";
  if (["boolean", "bool"].includes(type ?? "")) return "boolean";
  if (type === "object") return "object";
  if (["array", "list"].includes(type ?? "")) return "array";
  if (["json", "any", "unknown"].includes(type ?? "")) return "json";
  return "string";
}

export function launchFieldRawValue(field: WorkflowLaunchField, values: Record<string, string>): string {
  if (Object.prototype.hasOwnProperty.call(values, field.key)) return values[field.key] ?? "";
  return field.defaultValue ?? "";
}

function parseJsonValue(rawValue: string, field: WorkflowLaunchField): unknown {
  const kind = launchFieldKind(field);
  const parsed = JSON.parse(rawValue) as unknown;
  if (kind === "object" && !isRecord(parsed)) throw new Error(`${field.name} must be a JSON object.`);
  if (kind === "array" && !Array.isArray(parsed)) throw new Error(`${field.name} must be a JSON array.`);
  return parsed;
}

export function initialLaunchValues(fields: WorkflowLaunchField[]): Record<string, string> {
  return Object.fromEntries(fields.map((field) => [field.key, field.defaultValue ?? ""]));
}

export function launchValidationErrors(
  fields: WorkflowLaunchField[],
  values: Record<string, string>,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const kind = launchFieldKind(field);
    const trimmed = launchFieldRawValue(field, values).trim();
    if (field.required && kind !== "boolean" && !trimmed) {
      errors[field.key] = `${field.name} is required.`;
      continue;
    }
    if (!trimmed) continue;
    if (kind === "number" && !Number.isFinite(Number(trimmed))) {
      errors[field.key] = `${field.name} must be a number.`;
      continue;
    }
    if (["object", "array", "json"].includes(kind)) {
      try {
        parseJsonValue(trimmed, field);
      } catch (error) {
        errors[field.key] = error instanceof Error ? error.message : String(error);
      }
    }
  }
  return errors;
}

export function buildLaunchInput(
  fields: WorkflowLaunchField[],
  values: Record<string, string>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  for (const field of fields) {
    const kind = launchFieldKind(field);
    const hasCurrentValue = Object.prototype.hasOwnProperty.call(values, field.key);
    const rawValue = launchFieldRawValue(field, values);
    const trimmed = rawValue.trim();
    if (!trimmed && !field.required && field.defaultValue === null) continue;
    if (kind === "string") {
      input[field.key] = rawValue;
    } else if (kind === "number") {
      // An optional number the user cleared must NOT submit as 0. `Number("")`
      // is 0, so an empty optional number field is omitted entirely regardless
      // of whether the field declared a default — the absence is the signal.
      if (!trimmed && !field.required) continue;
      input[field.key] = Number(trimmed);
    } else if (kind === "boolean") {
      if (!field.required && field.defaultValue === null && !hasCurrentValue) continue;
      input[field.key] = ["true", "1", "yes", "on"].includes(trimmed.toLowerCase());
    } else {
      // object/array/json. An optional field the user left empty must be OMITTED,
      // not fed to JSON.parse(""). The line-80 guard only skips when the field
      // declared a null default; a field whose default is the empty string ("")
      // would otherwise fall through to JSON.parse("") and throw. Absence is the
      // signal for any empty optional structured field, regardless of default.
      if (!trimmed && !field.required) continue;
      input[field.key] = parseJsonValue(trimmed, field);
    }
  }
  return input;
}

/**
 * Fallback when a workflow exposes no declared launch fields: parse the freeform
 * JSON textarea. Empty -> empty object; non-object JSON is rejected.
 */
export function parseFreeformInput(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed) as unknown;
  if (!isRecord(parsed)) throw new Error("Workflow input must be a JSON object.");
  return parsed;
}
