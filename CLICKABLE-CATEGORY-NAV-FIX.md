# WESTO v13.3 — Clickable Category Navigation

## User-visible fix
- Hero category dock items are direct click/tap controls, not scroll-only controls.
- Hero progress rail is direct click/tap navigation; clicking anywhere on the line snaps to the nearest category.
- Active progress dot remains a single keyboard tab stop; Arrow/Home/End navigates and activates categories.
- Horizontal panning of the category dock is preserved.

## Root causes fixed
1. The custom progress rail had `pointer-events:none` and its existing click handler was never bound.
2. Global Three.js hero swipe/raycast arbitration did not classify the production category dock/rail as UI chrome, so taps could be consumed or followed by a hero side-lane action.
3. Programmatic `carousel.goTo()` from production chrome could target an idle render loop; explicit render wake is now issued after direct category activation.
4. Mobile vertical paging arbitration now ignores interactive hero chrome.

## Architecture preserved
- `carousel.goTo()` remains the authoritative category carousel transition.
- WebGL state ownership is unchanged.
- Horizontal swipe remains available as a secondary navigation path.
- Approved WESTO visual language, v8 pattern, cart/order ownership, and resource scheduler are unchanged.
