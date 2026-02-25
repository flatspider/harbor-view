# HAR-63: Add full-screen ocean underlay and eliminate ocean-land seam box

1. Add a large low-detail ocean underlay mesh beneath the detailed Water layer so ocean fills camera view at all times.
2. Expand the detailed Water footprint significantly beyond map extents to prevent visible rectangular boundaries in normal camera framing.
3. Tighten water depth behavior relative to land to avoid translucent ocean tint over land polygons.
4. Validate with typecheck/lint.

Acceptance criteria:
- No visible rectangular ocean boundary in typical zoom/pan.
- Ocean appears continuous to viewport edges.
- Land no longer appears as uniformly tinted by the ocean surface.
