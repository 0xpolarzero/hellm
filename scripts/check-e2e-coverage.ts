import { existsSync } from "node:fs";
import { FEATURE_E2E_COVERAGE, validateFeatureE2ECoverage } from "../e2e/feature-coverage";

const requireCompleteShipped = process.argv.includes("--require-complete-shipped");
const availableTestFiles = new Set(
  FEATURE_E2E_COVERAGE.flatMap((item) => item.testFiles).filter((path) => existsSync(path)),
);
const errors = validateFeatureE2ECoverage(availableTestFiles, requireCompleteShipped);

if (errors.length > 0) {
  for (const error of errors) console.error(error);
  process.exit(1);
}

const counts = Object.fromEntries(
  ["live", "projection", "missing"].map((level) => [
    level,
    FEATURE_E2E_COVERAGE.filter((item) => item.level === level).length,
  ]),
);
console.log(
  requireCompleteShipped
    ? `Shipped feature e2e coverage is complete: ${JSON.stringify(counts)}`
    : `E2E inventory accounts for every product feature: ${JSON.stringify(counts)}`,
);
