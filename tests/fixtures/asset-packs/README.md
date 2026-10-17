# P0 Synthetic Pack

`pack.mjs` exports `syntheticPack()` and `cardExtension()` plus stable UUID constants.
The pack is built entirely in memory. Its `files` Map contains every non-root file
and real SHA-256/size declarations: generated 8x8 PNGs, a silent PCM WAV, figure and
sprite JSON, credits/reference text, a widget HTML entry and a model3 relative tree.
Nothing reads a profile, downloads media, installs a package or executes the widget.

The Live2D Moc payload is deliberately uncompiled synthetic text, not a usable
Cubism model. This is a P0 structural/hash fixture, not P1 decoder or GPU acceptance.

The figure has two outfits, optional Live2D plus a still-image fallback, a full
layered v2 sprite with `soyo_haruhikage`, two views, fractional mouth anchors,
`mouthByFrame`, masks, an unused mouth set, per-outfit avatars and a clone-voice
descriptor. The model hashes describe requirements; no real model weights exist.
The background has explicit time variants; music shares its short ID intentionally.
