import { expect, test } from "bun:test";
import { parseAgentDirectives } from "./parseAgentDirectives";

test("lifts a directive block out of a reply and leaves clean prose", () => {
  const reply = [
    "Sure — switching you to dark mode and opening the Store.",
    "",
    "```smithers:action",
    '{"tool":"requestControl","reason":"switch to dark mode and open the Store"}',
    '{"tool":"setTheme","args":{"theme":"dark"}}',
    '{"tool":"navigate","args":{"view":"store"}}',
    "```",
  ].join("\n");

  const { cleanedText, directives } = parseAgentDirectives(reply);

  expect(cleanedText).toBe("Sure — switching you to dark mode and opening the Store.");
  expect(directives).toEqual([
    { tool: "requestControl", reason: "switch to dark mode and open the Store" },
    { tool: "setTheme", args: { theme: "dark" } },
    { tool: "navigate", args: { view: "store" } },
  ]);
});

test("returns no directives for a plain chat reply", () => {
  const { cleanedText, directives } = parseAgentDirectives("Just thinking out loud here.");
  expect(directives).toEqual([]);
  expect(cleanedText).toBe("Just thinking out loud here.");
});

test("strips a half-streamed (unterminated) block and skips malformed lines", () => {
  const midStream = 'Working on it…\n\n```smithers:action\n{"tool":"setTheme","args":{"the';
  const { cleanedText, directives } = parseAgentDirectives(midStream);
  // The open fence is hidden from the user; the partial JSON line is ignored.
  expect(cleanedText).toBe("Working on it…");
  expect(directives).toEqual([]);
});

test("ignores lines that are not objects with a string tool", () => {
  const reply = [
    "```smithers:action",
    '{"tool":"toggleTheme"}',
    "42",
    '{"noTool":true}',
    '{"tool":123}',
    "```",
  ].join("\n");
  const { directives } = parseAgentDirectives(reply);
  expect(directives).toEqual([{ tool: "toggleTheme" }]);
});
