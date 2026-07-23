---
description: Isolated Coding-Council arm for one benchmark repair snapshot
---

Run one bounded Coding-Council repair inside the current isolated benchmark snapshot.

$ARGUMENTS

Read `case.public.json`. Do not read parent directories, `.git`, hidden tests, fixed
revisions, patches, or network resources. Never install dependencies or delete files.
Only `review` and `test` are relevant scopes for this local repair fixture.

1. Start `plan` twice in parallel with the identical case input: one minimal plan and
   one robust/isolation-focused plan. Merge them without adding new scope.
2. For `review`, start `council-code-review`, `council-code-review-alt1`, and
   `council-code-review-alt2` in parallel. Explicitly require read-only proposals in
   the repository proposal format. Repeat the same with the three `test` variants.
3. Give all six proposals to `council-lead`. Require a strict first-line VERDICT and
   select exactly one proposal per scope. An invalid or missing VERDICT ends the run.
4. Run only each selected variant once more, sequentially, with write permission.
   It may change only `allowedChanges` and must not touch `forbiddenChanges`.
5. Run every visible test command from `case.public.json`. Do not run hidden tests or
   generic repository tests/builds that are not listed in the public case.
6. Self-review the final changes against the public case.
7. Run the relevant read-only Council redundantly: five `council-review` siblings and
   five `council-test` siblings receive the same final snapshot and frozen prompt.
   Retry an invalid response once with the identical prompt. Fewer than four valid
   responses in either scope makes the arm `UNCERTAIN`.
8. Give the valid reports to `council-lead` for candidate-only consolidation. For
   every potential HIGH or MEDIUM candidate, run `council-verify` twice independently
   and adversarially. Only `BUG` plus `BUG` is confirmed. Do not let a reviewer or
   verifier edit the snapshot.

The final response must begin with exactly `VERDICT: ISSUES_FOUND` when the repair and
visible tests succeed, otherwise `VERDICT: UNCERTAIN`. Then emit exactly one fenced
JSON object with `verdict`, `summary`, and `findings` (an array). Do not add text after
the JSON block.
