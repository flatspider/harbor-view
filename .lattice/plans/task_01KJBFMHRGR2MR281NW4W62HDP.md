# HAR-67: Remove under-polygon ocean skirt artifact

1. Remove the flat ocean underlay mesh that is visible beneath land extrusion walls.
2. Reduce land-mask depth push from extreme values to a shallow offset so constrained water remains but without visible vertical water cliffs under coastlines.
3. Validate with typecheck/lint.

Acceptance criteria:
- No reflective blue skirt under land polygons.
- Ocean boundaries remain clean in normal camera framing.
- Typecheck/lint passes.
