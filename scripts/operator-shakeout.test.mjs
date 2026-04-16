import test from "node:test";
import assert from "node:assert/strict";

import { buildOperatorShakeoutReport } from "./operator-shakeout.mjs";

test("buildOperatorShakeoutReport passes when expected workflows are listed", async () => {
  const repoRoot = new URL("..", import.meta.url).pathname;
  const report = await buildOperatorShakeoutReport({ repoRoot });

  assert.equal(report.status, "pass");
  assert.equal(report.checks.comment_eval_passes, true);
  assert.equal(report.checks.generated_pr_policy_enforces, true);
});
