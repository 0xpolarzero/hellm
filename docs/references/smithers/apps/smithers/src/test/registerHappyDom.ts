import { GlobalRegistrator } from "@happy-dom/global-registrator";

const nativeFetch = globalThis.fetch;
const nativeRequest = globalThis.Request;
const nativeResponse = globalThis.Response;
const nativeHeaders = globalThis.Headers;
const nativeAbortController = globalThis.AbortController;
const nativeAbortSignal = globalThis.AbortSignal;

/**
 * Register happy-dom for store/component tests without replacing Bun's native
 * network primitives. The jjhub and worker unit tests run in the same Bun
 * process and rely on real loopback fetches plus Cloudflare-like Request
 * headers; happy-dom's replacements do not preserve that behavior.
 */
export function registerHappyDomForTests(): void {
  if (typeof globalThis.window === "undefined") {
    GlobalRegistrator.register();
  }

  globalThis.fetch = nativeFetch;
  globalThis.Request = nativeRequest;
  globalThis.Response = nativeResponse;
  globalThis.Headers = nativeHeaders;
  globalThis.AbortController = nativeAbortController;
  globalThis.AbortSignal = nativeAbortSignal;
}
