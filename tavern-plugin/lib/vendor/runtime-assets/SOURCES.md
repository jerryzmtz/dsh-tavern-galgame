# Bundled Tavern browser runtime assets

These pinned files are shipped with dsh-tavern so card and MVU initialization does not depend on a CDN.
The corresponding license or notice is retained in each package directory.

- `@fortawesome/fontawesome-free@6.7.2`: `css/all.min.css`, required webfonts
- `@tailwindcss/browser@4.1.12`: `dist/index.global.js`
- `jquery@3.7.1`: `dist/jquery.min.js`
- `jquery-ui@1.14.1`: `dist/jquery-ui.min.js`, base theme and referenced images
- `jquery-ui-touch-punch@0.2.3`: `jquery.ui.touch-punch.min.js`
- `vue@3.5.41`: `dist/vue.runtime.global.prod.js`
- `vue-router@5.2.0`: `dist/vue-router.global.prod.js`
- `lodash@4.18.1`: `lodash.min.js`
- `marked@16.3.0`: `lib/marked.umd.js`
- `yaml@2.9.0`: jsDelivr `+esm` single-file browser bundle
- `zod@4.4.3`: jsDelivr `+esm` single-file browser bundle
- `three@0.186.1` (private fork, Card Stage): `build/three.module.js`, `build/three.core.js`, and a curated
  closure of `examples/jsm` under `three/addons/` (bare `three` imports rewritten to the relative build path;
  see `docs/fork/card-stage.md`)
- `pixi.js@6.5.10` (private fork, galgame stage): `dist/browser/pixi.min.js` → `live2d/pixi.min.js`
- `pixi-live2d-display@0.4.0` (private fork, galgame stage): `dist/cubism4.min.js` → `live2d/pixi-live2d-display-cubism4.min.js`.
  PRIVATE LOCAL COPY ONLY: this bundle embeds Live2D Cubism Framework under the Live2D Open Software License; the public export excludes this JS and its vendor LICENSE. No Live2D code (including Core) is distributed publicly. Users obtain Core from https://www.live2d.com/en/sdk/download/web/ and display from https://github.com/guansss/pixi-live2d-display/releases/tag/v0.4.0 or the publisher npm package. The app only imports user-selected files into its data directory and never downloads code. Existing private vendor copies remain usable. Live2D Publication License obligations are not waived; arbitrary-model applications must review the Expandable Application terms.

The package files come from the exact pinned npm packages or jsDelivr npm URLs recorded above.
