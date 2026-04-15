import { createContext, useContext, useState } from "react";

export type PaneType = "subagent" | "workflow" | "artifact" | "thread" | "diff";

export interface PaneItem {
  id: string;
  type: PaneType;
  title: string;
  data: any;
}

interface PanesContextValue {
  additionalPanes: PaneItem[];
  openPane: (type: PaneType, data: any, title: string) => void;
  closePane: (id: string) => void;
  replacePane: (id: string, type: PaneType, data: any, title: string) => void;
}

const PanesContext = createContext<PanesContextValue>({
  additionalPanes: [],
  openPane: () => {},
  closePane: () => {},
  replacePane: () => {},
});

export function PanesProvider({ children }: { children: React.ReactNode }) {
  const [additionalPanes, setAdditionalPanes] = useState<PaneItem[]>([]);

  const openPane = (type: PaneType, data: any, title: string) => {
    const newPane: PaneItem = { id: `pane-${Date.now()}`, type, data, title };
    setAdditionalPanes(prev => {
      if (prev.length >= 2) {
        return [...prev.slice(0, 1), newPane];
      }
      return [...prev, newPane];
    });
  };

  const closePane = (id: string) => {
    setAdditionalPanes(prev => prev.filter(p => p.id !== id));
  };

  const replacePane = (id: string, type: PaneType, data: any, title: string) => {
    const newPane: PaneItem = { id: `pane-${Date.now()}`, type, data, title };
    setAdditionalPanes(prev => prev.map(p => (p.id === id ? newPane : p)));
  };

  return (
    <PanesContext.Provider value={{ additionalPanes, openPane, closePane, replacePane }}>
      {children}
    </PanesContext.Provider>
  );
}

export function usePanes() {
  return useContext(PanesContext);
}
