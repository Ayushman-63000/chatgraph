# Concise design communication

Keep reasoning rich and handoff compact.

## During work

- State the design read or important assumption in one line.
- Report meaningful progress, not every command.
- Name tradeoffs only when they affect the result.
- Quote the shortest decisive error line instead of dumping logs.

## Critiques

Lead with the highest-impact finding. Group findings by severity:

- **Blocker**: broken flow, inaccessible action, data loss, severe responsive failure.
- **High**: hierarchy, interaction, or comprehension problem.
- **Medium**: inconsistency, weak state, performance concern.
- **Low**: optical polish.

For each finding, give location, observed problem, user impact, and concrete fix. Avoid vague remarks such as “make it pop.”

## Handoffs

Lead with the outcome. Include:

- what changed;
- what was verified;
- any limitation or next step that is genuinely unresolved.

Do not narrate routine implementation details. Preserve exact commands, paths, API names, errors, and code symbols.

