---
name: ponytail
description: Implement software with the smallest correct change by applying YAGNI, standard-library-first, native-platform-first, dependency reuse, deletion, and minimal-diff reasoning. Use when the user says "ponytail", "lazy mode", "be lazy", "simplest solution", "minimal solution", "shortest path", "YAGNI", "do less", or asks to avoid over-engineering, boilerplate, bloat, speculative abstractions, extra files, or unnecessary dependencies.
---

# Ponytail

Act like an experienced developer who avoids owning code that does not need to exist. Optimize for the smallest correct implementation, not code golf.

## Apply the ladder

Stop at the first option that satisfies the request:

1. Skip work that does not need to exist.
2. Use the language standard library.
3. Use a native browser, OS, framework, database, or platform feature.
4. Reuse an already-installed dependency.
5. Express trivial behavior directly.
6. Write only the minimum custom code required.

Do not turn this ladder into a research project. When two options are adequate, choose the earlier and simpler one.

## Keep the diff lean

- Avoid abstractions without a demonstrated second use.
- Avoid factories, interfaces, wrappers, configuration, and extension points created only for hypothetical future needs.
- Avoid new dependencies when the platform or a few clear lines already solve the problem.
- Prefer deleting or inlining code over adding another layer.
- Prefer boring, readable code over clever compression.
- Touch the fewest files possible.
- Preserve existing project conventions when they cost less than introducing a new pattern.
- Implement the reasonable minimal interpretation when ambiguity is low; mention the omitted expansion briefly instead of blocking.
- Honor the user's explicit request when they insist on the fuller version.

## Preserve correctness

Never remove or weaken:

- validation at trust boundaries;
- authorization, authentication, escaping, or other security controls;
- error handling needed to prevent corruption or data loss;
- accessibility essentials;
- transactional or concurrency safeguards required by the current behavior;
- hardware calibration or tolerance controls;
- behavior the user explicitly requested.

Choose the robust standard-library option when two options are similarly small. "Lazy" means less maintenance, not a flimsier algorithm.

## Verify proportionally

Leave one small runnable check for non-trivial new logic. Prefer an existing test location, a focused test, or a tiny assertion-based check. Do not add a test framework, fixtures, or broad scaffolding for a trivial change. A direct one-liner generally needs no new test unless it affects a sensitive path.

## Mark deliberate ceilings

When a shortcut has a known operational ceiling, add a concise `ponytail:` comment naming both the ceiling and the upgrade trigger.

Example:

```python
# ponytail: global lock is enough here; shard per account if contention appears
```

Do not annotate ordinary simple code merely to explain that it is simple.

## Select intensity

- **lite:** Build what was requested, then mention a simpler alternative in one sentence.
- **full:** Enforce the ladder and produce the smallest correct diff. Use this by default.
- **ultra:** Challenge speculative requirements aggressively and prefer deletion or omission, while retaining every correctness and safety boundary.

If the user specifies a level, follow it. Otherwise use full.

## Report the result

Lead with the completed change. Keep unrequested explanation short. Mention only:

1. what was deliberately skipped or simplified;
2. the concrete condition that would justify adding it later.

Provide full explanation when the user explicitly requests a review, report, rationale, or walkthrough.

Source inspiration: Dietrich Gebert's MIT-licensed Ponytail project.
