import test from "node:test";
import assert from "node:assert/strict";

import { buildSkillProposalMarkdown } from "./write-skill-proposal.mjs";

test("buildSkillProposalMarkdown preserves issue rationale and evidence", () => {
  const markdown = buildSkillProposalMarkdown({
    title: "Add an issue-ledger recap skill",
    issueUrl: "https://github.com/nilstate/aster/issues/42",
    jsonPath: "/tmp/issue-ledger-recap.json",
    payload: {
      skill_spec: {
        name: "issue-ledger-recap",
        summary: "Summarize approval issue threads into a reusable packet.",
      },
      execution_plan: {
        runner: "chain",
      },
      harness_fixture: [
        {
          name: "success",
        },
      ],
      acceptance_checks: [
        {
          id: "ac-fixture-passes",
          assertion: "fixture passes",
        },
      ],
    },
    issuePacket: {
      sections: {
        why_it_matters: "Issue review should train the operator.",
        constraints: "- proposal only",
        evidence: "- state/thread-teaching.json",
        additional_notes: "Prefer bounded review surfaces.",
      },
    },
  });

  assert.match(markdown, /^title: "issue-ledger-recap"$/m);
  assert.match(markdown, /## Why It Matters/);
  assert.match(markdown, /Issue review should train the operator\./);
  assert.match(markdown, /## Evidence/);
  assert.match(markdown, /state\/thread-teaching\.json/);
  assert.match(markdown, /## Acceptance Checks/);
  assert.match(markdown, /`ac-fixture-passes`: fixture passes/);
  assert.doesNotMatch(markdown, /\[object Object\]/);
  assert.match(markdown, /description: "Summarize approval issue threads into a reusable packet\."/);
});
