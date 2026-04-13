import { defineElectrobunE2EConfig } from "electrobun-e2e/config";

export default defineElectrobunE2EConfig({
  appName: "svvy",
  runtimeEnv: {
    SVVY_E2E_HEADLESS: "1",
  },
});
