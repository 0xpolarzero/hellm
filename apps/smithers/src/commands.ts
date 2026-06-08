/**
 * The three top-level views, as the command pill presents them. Pure data with
 * no component or store imports, so workflows and notifications can reference a
 * view id without pulling in the router graph.
 */
export type CommandId = "chat" | "askme" | "store" | "concierge";

export type Command = {
  id: CommandId;
  label: string;
  color: string;
  hint: string;
};

export const COMMANDS: Command[] = [
  { id: "chat", label: "Chat", color: "#356fd2", hint: "Talk to Smithers" },
  {
    id: "askme",
    label: "Ask Me",
    color: "#6d56d8",
    hint: "Smithers grills you to sharpen an idea",
  },
  {
    id: "store",
    label: "Store",
    color: "#bf5b16",
    hint: "Browse the workflow app store",
  },
  {
    id: "concierge",
    label: "Concierge",
    color: "#3f8f6f",
    hint: "Context-engineer your task",
  },
];
