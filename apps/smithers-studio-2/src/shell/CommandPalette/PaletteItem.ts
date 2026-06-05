/**
 * A single command-palette result. `section` groups rows under an uppercased
 * header; `run` executes the action and is responsible for closing the palette
 * when appropriate.
 */
export type PaletteItem = {
  id: string;
  section: string;
  title: string;
  subtitle: string;
  icon: string;
  shortcut?: string;
  run: () => void;
};
