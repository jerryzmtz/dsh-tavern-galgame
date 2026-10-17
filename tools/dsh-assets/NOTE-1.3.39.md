# dsh-assets 1.3.39: adopt an untracked installed mouth

Use `adopt-installed-mouth` when a historical mouth publish is present in the native library but absent from the receiving project's tracking. This is not force replacement and does not grant approval.

```text
node bin/dsh-assets.mjs adopt-installed-mouth --project RECEIVER --slot FIG/OUTFIT/sprite/EMOTION --source-root HISTORICAL_PROJECT --historical-revision HISTORICAL_INSTALL_UUID --expected-state EXPECTED_MOUTH.json --library LIB --expected-revision FRESH_UUID --dry-run --json
```

`EXPECTED_MOUTH.json` is the complete native hash-resolved mouth state `{binding,set}` (including canvas, anchor, pivot and four frame hashes), not just a frame list. The historical project must retain accepted artifacts and `sources/image-install.json` with matching four slot versions/hashes/revisions and the full group/source record. Historical image bytes are verified at this external trust boundary. The current native source pixels and complete mouth state must match; source version/hash must match the receiver. Only whole static-sprite routes are supported.

Remove `--dry-run` to atomically write the group, four historical slot records and `mouthAdoptions[SOURCE_SLOT]` receipt together in the receiver's `sources/image-install.json`. The receipt contains the exact source, group, four historical records, historical revision and observed native revision/contentHash. Project JSON, candidate versions, approvals and native library are untouched. A repeated identical adoption is `noop` and writes no files. Existing conflicting tracking is rejected; an old adoption cannot be replayed after replacement to reset the baseline.

Then use the normal exact four-slot `pack` / `install --dry-run` / `install --confirm` animation workflow with a freshly read library revision. Existing three-way checks remain unchanged. The approved candidate may differ from the adopted historical group; its approvals are checked by the normal compiler, not by adoption.

Upgrade the portable tool folder as a whole; do not re-init projects or copy another project's tracking JSON. For the basin smug case the historical source is basin-rice's mouth-authoring-project, revision `910caa62-4a71-4509-add4-514ee30a7097`. Run adoption only where the real installed state and historical evidence are available; Dot should mirror the returned scoped tracking receipt through this command against its own matching library, not fabricate a native library or copy approvals.

## Clear a failed derived animation

`remove --slot FIG/OUTFIT/mouth/EMOTION/FRAME` (or a blink slot) now permits a source-bound derived animation on a layered/parts source when stale or without an artifact. Dry-run previews the normal versioned removal delta. It clears current slot content/stale flags to missing and retains the source binding, historical plans and generation/budget log. It does not reset the attempt budget or remove source rigs, parts or their media. Real layered source slots and non-stale completed layered animations retain the explicit rig/part guard.

Dot: drooling/mid at r450 can now be marked plain missing with the normal remove command; inspect --dry-run first, then apply. Keep the three failed attempts and spent budget as history. No regeneration is authorized by this operation.
