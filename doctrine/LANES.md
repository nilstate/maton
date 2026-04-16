---
title: Automaton Lanes
updated: 2026-04-17
visibility: public
---

# Automaton Lanes

The operator works through bounded lanes.

## Live Lanes

- `issue-triage`: triage a GitHub issue or inbound PR, decide whether planning or a worker should start, and only publish a bounded public comment when it can be said cleanly in Kam's voice.
- `fix-pr`: fix one bounded bug in one bounded repo surface and publish it as a governed draft PR with verification receipts.
- `docs-pr`: improve docs or repo explanation through a docs-only governed draft PR with verification receipts.
- `skill-lab`: validate a skill against real automaton work and record whether it is actually useful.
- `skill-upstream`: contribute a portable `SKILL.md` upstream into another repo.
- `merge-watch`: observe upstream contribution state and publish public proof when the status changes.
- `proving-ground`: run bounded `runx` lanes against the repo to surface missing boundaries and evidence quality.

## Canonical Next Lanes

- `skill-recon`: investigate whether a skill should exist at all.
- `trust-audit`: publish a public evaluation of a skill, lane, or target.
- `market-brief`: publish market intelligence on the agent ecosystem.

## Support Workflows

- `site-pages`: deploy the public site from repo-owned operator content.
- `generated-pr-policy`: enforce draft-only, human-reviewed policy on generated `runx/*` PRs.
- `rollback`: publish a corrective comment or close a generated PR when earlier automaton output must be superseded.

## Public Voice Rule

Any lane that emits a public GitHub comment, issue, review, or pull request must:

- sound like Kam using tools, not like a bot persona
- carry one concrete unblock or bounded change
- hide internal machinery unless disclosure is materially useful
- prefer `no_op` over robotic participation

Every lane must:

- consume a bounded context bundle
- emit receipts or artifact references
- leave history and reflection updates to the promotion layer
