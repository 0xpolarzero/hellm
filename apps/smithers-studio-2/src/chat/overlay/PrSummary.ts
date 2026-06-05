/**
 * Minimal PR shape the default PR overlay renders. SEAM: today seeded; later
 * from the VCS integration behind the same type.
 */
export type PrSummary = {
  number: number;
  title: string;
  author: string;
  branch: string;
  state: "open" | "merged" | "draft";
  additions: number;
  deletions: number;
  changedFiles: number;
  checks: { name: string; status: "pass" | "fail" | "pending" }[];
};
