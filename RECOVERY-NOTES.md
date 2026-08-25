# WESTO v13.1 Recovery Notes

This release is a recovery/refinement of v13 after a functional and visual regression report.

## Critical root cause

`fillGate()` called `tiktokUrl()` although that helper did not exist. With restaurant bootstrap data this could throw during `initLoader()` before the later entrance and menu handlers were bound, producing the observed combination of a stuck loading gate and controls that appeared dead.

The recovery defines the helper, defers/catches restaurant hydration so content rendering cannot abort interaction binding, caps explicit entrance warmup, and shortens the degraded 3D fallback.

## Visual recovery rule

The approved v12.9/v8 visual cascade is restored byte-for-byte as the prefix of `css/westo-production-v12.css`. v13.1 only appends non-invasive human-factor guards for keyboard focus, reduced motion, forced colors, edge viewport reachability, semantic helpers, and targeted hit-area expansion.

Broad v13 rules that changed default opacity, selected-state decoration, native color scheme, media sizing, hidden behavior, mobile button geometry, text measure, radius, or tablet gaps were removed.

## Design logic audit

The recovery audit retains all 396 registered component/system instances and evaluates them through 30 design-logic lenses in 10 device/theme contexts (118,800 rows), plus 10 failure probes per component (3,960 rows). Static evidence is marked separately from browser/device/human validation; no fake 100% visual or cognitive claim is made.
