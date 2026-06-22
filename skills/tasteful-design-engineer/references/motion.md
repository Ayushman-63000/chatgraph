# Purposeful motion

Use motion as interaction design, not garnish.

## Decide whether to animate

Apply the frequency gate:

| Trigger frequency | Treatment |
| --- | --- |
| Hundreds of times per day or keyboard initiated | No animation or near-instant feedback |
| Daily or occasional | Fast, subtle transition |
| Rare, onboarding, celebration, campaign moment | More expressive motion may be justified |

Ask what users learn from the motion. Valid answers include state change, cause and effect, spatial continuity, hierarchy, or brand character.

## Timing

- Product UI: usually 150–250 ms.
- Polished consumer interaction: usually 200–450 ms.
- Expressive brand moments: duration follows the narrative, but must not block action.
- Exit motion should usually be shorter and quieter than entry motion.

Use intentional easing. Prefer decelerating ease-out curves for entrances and direct feedback. Avoid bounce or elastic motion unless playfulness is central to the product.

## Performance

Prefer:

- `transform`;
- `opacity`;
- carefully bounded `filter`, `clip-path`, or masks.

Avoid animating:

- width and height;
- top, left, margins, and padding;
- font size;
- large blurred surfaces across the full viewport.

Use `will-change` only shortly before or on a small number of elements that actually animate. Test on a constrained device or throttled environment when motion is substantial.

## Accessibility

Support `prefers-reduced-motion` in the same implementation.

For decorative motion, remove it. For functional motion, replace it with an instant state change or non-motion cue.

Avoid:

- uncontrolled loops;
- large zooms and spins;
- heavy parallax;
- scroll hijacking;
- effects that prevent task completion when disabled.

Provide pause controls for ambient animation that persists.

## Implementation checks

- Content must remain visible if JavaScript, observers, or animations fail.
- Do not gate initial visibility behind a reveal class.
- Keep pointer-driven continuous values outside React state where possible.
- Keep product-page load choreography minimal; users arrived to work.
- Use one orchestrated sequence instead of unrelated fade-ups on every section when a brand surface genuinely needs entrance motion.

