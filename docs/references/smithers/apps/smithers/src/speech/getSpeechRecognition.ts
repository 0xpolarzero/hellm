import type { SpeechRecognitionLike } from "./SpeechRecognitionLike";

/**
 * Construct a SpeechRecognition instance for dictation, or null when the
 * browser has no Web Speech API. Checks both the standard and the webkit-
 * prefixed constructor.
 */
export function getSpeechRecognition(): SpeechRecognitionLike | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  const Recognition = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  return Recognition ? new Recognition() : null;
}
