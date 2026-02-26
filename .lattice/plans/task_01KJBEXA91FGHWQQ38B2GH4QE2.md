# HAR-64: Force northbound 12-knot ocean current for testing

1. Add a temporary ocean-only current override in `src/scene/ocean.ts` to force current speed to 12 knots and direction to 0 degrees (north).
2. Ensure both water motion and current arrows read from this override.
3. Validate via typecheck/lint.

Acceptance criteria:
- Ocean animation behaves as if current is 12 kn north regardless of integration feed.
- Arrows point north for test run.
