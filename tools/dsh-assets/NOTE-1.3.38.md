# dsh-assets 1.3.38

Boundary hardening for `restore-installed-replacement` and `attach-installed-layered` (1.3.37). Command arguments and receipt formats are unchanged.

Three gates run before project commit, including dry-run and exact replay:

- An inventory parent UUID can map only to an installed-baseline inventory identity with the matching pixels and its real native revision UUID. A numerically versioned authoring candidate cannot stand in for that inventory parent, even if its pixels match. Numeric authoring parents must retain their exact version and be approved.
- Every imported raw, artifact, patch and source image reference must have a PNG signature and pass PNG structure, decompression, decoded size and filter checks. Correct SHA alone is not sufficient. Each foreign path is decoded once per import; every reference still checks its hash and dimensions.
- Declared width/height must equal decoded PNG dimensions. Selected installed part rectangles must also match those validated pixel dimensions. Existing native/source byte and SHA checks remain unchanged.

No acceptance is invented, no native library is written, and no live restart is required. Existing source provenance and receipts remain intact.

Verification: focused negative cases cover an unapproved numeric parent, correct-hash non-PNG raw, and declared 3x4 versus decoded 4x4; each rejects both initial import and replay. Valid synthetic restores still pass. A fresh `.tmp/dsh1338/` proof restores r391 (443 targets), then r398 (299 files), then the supplied local delta (1965 files, 51 CAS operations), recovering all three maid avatars and the approved basin layered entry. Replay reports zero changed operations and all four commands idempotent. Immutable media uses ordinary hardlinks, not junctions.

Delivery: `dsh-assets-1.3.38.zip`, `dsh-assets-1.3.38.zip.sha256`, and this NOTE. The ZIP is built using `scripts/release/zip-portable.mjs` from the allowlisted portable bundle.
