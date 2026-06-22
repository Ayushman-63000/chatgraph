# Taste and design judgment

Use this reference to choose and evaluate interface decisions.

## Begin with context

Determine whether design is the product or serves the product.

- **Brand surface**: landing page, campaign, portfolio, editorial, marketing.
- **Product surface**: app, dashboard, admin, settings, workflow, data tool.

Brand work needs a memorable point of view. Product work needs earned familiarity. Do not apply a brand-site appetite for novelty to a settings screen, or product restraint to a campaign that must be remembered.

## Build hierarchy before decoration

Ask:

1. What does the user need to understand?
2. What should they do next?
3. What evidence makes that action feel safe?

Use scale, position, spacing, contrast, and sequence to answer those questions. Decoration that does not strengthen one of them is optional.

## Typography

- Choose type from the brand voice and reading context, not from category reflex.
- Use one family well before adding a second family without a clear contrast role.
- Keep body copy around 45–75 characters per line.
- Use balanced wrapping for headings and pretty wrapping for prose where supported.
- Avoid display type in dense product controls.
- Test real copy at narrow and intermediate widths. Large type that overflows is not expressive; it is broken.
- Do not ban a font merely because it is common. Ban unconscious selection. Existing identity wins.

## Color

- Pick a strategy: restrained, committed, full palette, or drenched.
- Give each color a job. Product accents usually indicate action, selection, or state.
- Use one coherent neutral family rather than mixing warm and cool grays accidentally.
- Verify text, placeholder, icon, border, and focus-ring contrast.
- Avoid default purple-blue AI gradients, warm-paper luxury palettes, or monochrome editorial styling unless the brief actually calls for them.
- Never use gray text on a saturated background when a darker shade of that background or text-color transparency reads better.

## Layout

- Use rhythm: tight groups, generous separations, and deliberate exceptions.
- Use cards only when containment, comparison, interaction, or elevation needs them.
- Avoid endless identical grids and repeated left-right zigzags.
- Keep navigation stable and single-line at desktop widths.
- Give heroes one job. Do not turn them into feature lists, trust walls, and pricing summaries simultaneously.
- Make mobile collapse explicit. Reorder content by meaning, not merely DOM convenience.
- Use a semantic z-index scale.

## Content and assets

- Write specific draft copy. Avoid “elevate,” “seamless,” “unleash,” “next-gen,” “game-changer,” and generic placeholder companies.
- Use realistic values and names when fixtures are needed.
- Use real screenshots, generated imagery, verified stock, or honest placeholders with required dimensions.
- Keep icon family and stroke weight consistent.
- Add alt text that describes meaningful content rather than file type.

## Interaction quality

Every relevant control needs:

- default;
- hover;
- visible focus;
- active/pressed;
- disabled;
- loading;
- error;
- success.

Prefer skeletons that match final geometry over a generic central spinner. Empty states should explain what can happen next. Error copy should state what failed and how to recover.

## Anti-template review

Ask two questions:

1. Could the category alone predict this design?
2. Could the instruction “avoid the obvious category design” predict the replacement?

If either answer is yes, return to the audience, physical context, content, and brand voice. Avoiding the first cliché by selecting the fashionable anti-cliché is still reflex.

## Polish order

Fix in this order:

1. broken flow, accessibility, and responsive behavior;
2. hierarchy and information architecture;
3. design-system drift;
4. typography and spacing;
5. color and surface consistency;
6. interaction states and motion;
7. tiny optical details.

Never perfect one corner while the rest remains visibly unfinished.

