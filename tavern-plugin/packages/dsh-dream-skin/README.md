# DSH Tavern bundled Dream Skin

Based on [RevolutionLA/dsh-dream-skin](https://github.com/RevolutionLA/dsh-dream-skin), npm version **9.23.0**, MIT (see LICENSE).

Tavern changes:
- Add light/dark Tavern Terracotta definitions from `tavern-themes.json`, with display labels in the native skin picker.
- The native light/dark preference drives which half of that pair is active. The two skins declare a shared `schemeFamily`, and every skin restore resolves the saved id against the built-in preference first — without it the stored (light) Terracotta id overrode a built-in `dark` on every boot, since a skin and the built-in preference share one `ui-theme.preference` slot.
- Fresh preferences select Tavern Terracotta, with no factory image, URL or gradient. Existing user preferences are retained by the upstream persistence logic.
- Skin selection still offers its built-in gradients; manually chosen wallpapers remain supported.

This runtime snapshot ships inside Tavern, including npm/Git installations. It is not independently published. Refresh with `node bin/vendor-dream-skin.mjs /path/to/unmodified/dsh-dream-skin-9.23.0` and rerun theme and package checks. No host dependency upgrade is required.
