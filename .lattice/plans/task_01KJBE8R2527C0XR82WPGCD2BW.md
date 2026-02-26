# HAR-61: Fix ocean edge artifact and improve spatial current directions

1. Remove mask-induced boundary walls by preventing out-of-bounds world samples from being treated as land when applying the water geometry land mask.
2. Upgrade flow field in `src/scene/ocean.ts` from mostly uniform heading to a region-aware model (base tidal vector + localized rotational cells + corridor boosts), so arrows show meaningful directional variation across harbor zones.
3. Keep arrows visible and coherent with the revised field and run typecheck/lint.

Acceptance criteria:
- No rectangular/cliff artifact at ocean tile edges.
- Arrows show multiple local directions (not one near-uniform field) while still respecting the global current heading.
- Typecheck/lint passes.
