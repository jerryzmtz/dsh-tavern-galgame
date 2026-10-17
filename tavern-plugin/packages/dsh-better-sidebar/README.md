# Bundled sidebar runtime

Runtime files from `dsh-better-sidebar@0.19.1` (MIT), with the existing
`patches/dsh-better-sidebar@0.19.1.patch` applied to the host entry.
Upstream: https://github.com/omdsh-dev/DSH-better-sidebar

The standard Tavern package mounts these prebuilt files by relative path.
It does not install the upstream development/client dependency graph or run
node-pty install scripts. The sidebar loads node-pty lazily from the DSH host;
if unavailable, its terminal reports the upstream repair guidance.

Legacy installers continue using the patched npm dependency. Do not edit these
generated files. Refresh from the pinned, patched local dependency using
`node bin/vendor-plugin-package.mjs --host-root /path/to/dsh/node_modules`.
