# Mandatory final learning gate

Run this gate immediately before the final response for every Blender task, whether it completed, stopped, or remains blocked. Use evidence already produced by the task; do not reopen all skills, scan unrelated history, or invent a lesson merely to make a change.

## 1. Check for candidates

Review whether the task contained any of these signals:

- failed QA, a failed command, retry, workaround, or manual recovery;
- user correction or a result that looked right in Blender but differed after export, import, packaging, or runtime loading;
- misleading validation, missing evidence, repository pollution, unstable randomness, repeated manual work, or unnecessary context/tool calls;
- a rule that was missing, ambiguous, obsolete, duplicated, routed poorly, or repeatedly skipped;
- a successful new technique that demonstrably preserves the required result with less work.

Passing final QA does not erase earlier signals. Review recovered failures and discarded attempts too.

## 2. Decide from evidence

For each candidate, ask:

1. Is the cause understood and the remedy verified on the failing case?
2. Would the lesson change a future Blender task beyond this exact asset, style choice, machine state, or temporary outage?
3. Is it absent from the owning skill, helper, or evaluation, or is existing guidance placed so poorly that it was reasonably missed?
4. Can it be expressed as a scoped rule or observable check without weakening QA or overfitting one example?

Classify the result:

- **No candidate:** no skill change.
- **Already covered:** no duplicate change; improve placement or enforcement only when the task shows the existing rule was reasonably missed.
- **Unverified or one-off:** no permanent change; state the remaining uncertainty only when it matters to the user.
- **Verified reusable lesson:** before the final response, read [the improvement cycle](iterative-improvement.md), update the smallest owner, and validate that update.

Two occurrences of the same avoidable failure across tasks are strong evidence that wording, routing, or tooling needs improvement. One occurrence is enough when the invariant and remedy are deterministic and narrowly scoped.

## 3. Close the gate visibly

The final response must include one compact learning result:

- `Learning check: no new verified reusable lesson.`
- `Learning check: existing guidance already covers <topic>; no skill change.`
- `Learning check: improved <skill/check> for <verified lesson>; validation <result>.`

Do not create a report file, incident diary, or skill edit solely to satisfy this gate. Omitting the check is a workflow failure; concluding that no change is needed is a valid result.
