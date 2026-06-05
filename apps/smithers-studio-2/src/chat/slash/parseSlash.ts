/** A composer input split into a slash command name and its raw args. */
export type ParsedSlash = { name: string; args: string };

/**
 * Parse composer text into a slash command, or null if it isn't one. The name
 * is the first whitespace-delimited token after `/` (lowercased); everything
 * after is the (trimmed) args. Bare `/` parses to an empty name, which the
 * autocomplete treats as "match everything". Pure — unit-tested.
 */
export function parseSlash(input: string): ParsedSlash | null {
  const trimmed = input.replace(/^\s+/, "");
  if (!trimmed.startsWith("/")) return null;
  const body = trimmed.slice(1);
  const match = /\s/.exec(body);
  if (!match) return { name: body.toLowerCase(), args: "" };
  return { name: body.slice(0, match.index).toLowerCase(), args: body.slice(match.index + 1).trim() };
}
