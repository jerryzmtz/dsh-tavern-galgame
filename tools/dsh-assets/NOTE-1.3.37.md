# dsh-assets 1.3.37

Two read-only-library recovery commands close the cross-checkpoint authoring gaps.

```
node bin/dsh-assets.mjs restore-installed-replacement --project CANONICAL --source-root LOCAL_AUTHORING --slot FIG/OUTFIT/avatar/EMOTION --expected-version CANONICAL_NATIVE_UUID --library LIB --expected-revision CURRENT_NATIVE_UUID
node bin/dsh-assets.mjs attach-installed-layered --project CANONICAL --source-root APPROVED_LAYERED_AUTHORING --outfit FIG/OUTFIT --expected-version 0 --file ACTUAL_PARTS_INSTALL_RECEIPT.json --library LIB --expected-revision CURRENT_NATIVE_UUID
```

Both accept `--dry-run`. Neither writes a native library, invents acceptance, invokes generation, or reinstalls images. Work on an isolated restored canonical project first.

Replacement restore requires an accepted `replace-installed` source slot, its exact `sources/image-install.json` record, matching native installed bytes, the receiver's old placeholder pixels and expected version, and an unchanged parent image. It preserves the source slot, raw image, plans, geometry, reviewer and acceptance. The original native predecessor UUID is retained even when the receiver baseline UUID differs. Only a parent inventory UUID is remapped to the receiver's exact same parent image; the original binding is retained in `sources/restored-replacements/`. Existing non-placeholder work conflicts, never gets overwritten. Tracking is merged per slot; historical install revisions remain historical. A restored installed slot keeps the source project's QA policy, even when the canonical project's policy differs; `restoredReplacements` pins that exception to the exact recovered slot and the unchanged canonical framing configuration. Any later slot or framing edit restores normal canonical QA gates. This preserves historical approval rather than fabricating a new framing review.

Layered attachment requires an approved source project and its actual install receipt. The selected installed rest recipes, all selected part geometry/revisions/hashes, and source assets must match. Existing canonical layered authoring cannot be overwritten. The original layered document and source review are retained; `sources/layered-install/` contains the original project and receipt. `layeredInstalls` records the installed attachment, not a new human approval. Images-project status keeps declared mouth/blink slots visible; the installed repaired sprites are reported as baseline-installed. This is an attachment/recovery command, not a broad layered native installer. Native animation frames changed later are not rolled back.

Foreign authoring PNGs are checked at the import/approval trust boundary, including replay. Stale CAS, receipt mismatch and byte tampering fail before project commit. Exact replays do not advance project revision. 1.3.36 remains available for normal authoring/installation; use 1.3.37 for these two recovery commands.
