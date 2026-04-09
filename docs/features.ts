/**
 * Exhaustive feature inventory for the current implementation bootstrap.
 *
 * This file intentionally reflects the repository as it exists today after the
 * Electrobun reset, not the larger aspirational product from the earlier PRD.
 */
export enum HellmFeature {
  DesktopElectrobunShell = "bootstrap.desktop.electrobunShell",
  BunMainProcess = "bootstrap.desktop.bunMainProcess",
  BunSidePiHost = "bootstrap.piHost.bunSidePiHost",
  PiSdkSessionHost = "bootstrap.piHost.piSdkSessionHost",
  RendererRpcBridge = "bootstrap.rpc.rendererRpcBridge",
  PiWebUiChatSurface = "bootstrap.ui.piWebUiChatSurface",
  PromptStreaming = "bootstrap.chat.promptStreaming",
  SessionReuseAcrossPrompts = "bootstrap.chat.sessionReuseAcrossPrompts",
  SessionModelMutation = "bootstrap.chat.sessionModelMutation",
  SessionThinkingLevelMutation = "bootstrap.chat.sessionThinkingLevelMutation",
  ProviderAuthSettingsUi = "bootstrap.auth.providerSettingsUi",
  LocalProviderAuthStore = "bootstrap.auth.localProviderAuthStore",
  OAuthProviderLogin = "bootstrap.auth.oauthProviderLogin",
  EnvBackedProviderKeys = "bootstrap.auth.envBackedProviderKeys",
  ViteRendererBuild = "bootstrap.build.viteRendererBuild",
  ElectrobunBundleCopy = "bootstrap.build.electrobunBundleCopy",
  HmrRendererDevelopment = "bootstrap.dev.hmrRendererDevelopment",
}

export const ALL_HELLM_FEATURES = Object.values(HellmFeature);
