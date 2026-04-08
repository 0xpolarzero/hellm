export interface VerificationResult {
  readonly command: string;
  readonly ok: boolean;
  readonly summary: string;
}

export const verificationPassed = (command: string): VerificationResult => {
  return {
    command,
    ok: true,
    summary: `${command} passed`,
  };
};
