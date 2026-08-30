import type { AppLogViewPreferences } from "@svvy/core";

export type AppLogViewPreferencesWriter = {
  write(preferences: AppLogViewPreferences): Promise<void>;
};

export function createAppLogViewPreferencesWriter(
  persist: (preferences: AppLogViewPreferences) => Promise<void>,
): AppLogViewPreferencesWriter {
  let tail = Promise.resolve();

  return {
    write: (preferences) => {
      const snapshot = structuredClone(preferences);
      const write = tail.then(() => persist(snapshot));
      tail = write.catch(() => undefined);
      return write;
    },
  };
}
