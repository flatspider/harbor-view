# HAR-66: Make water motion strictly follow current speed/direction

1. Reduce Water.js built-in directional drift dominance by decoupling absolute time drive from aggressive default flow.
2. Drive normal-map UV advection directly from current heading and knots so observed water motion aligns with environment current direction.
3. Remove hard speed saturation in flow modeling so higher knot values materially affect motion and arrows.
4. Validate with typecheck/lint.

Acceptance criteria:
- Changing current direction visibly rotates water movement direction.
- Increasing knots strongly increases movement speed.
- Arrows and water move coherently.
