# Stage UI sound cues - credits and licence

All seven files are the owner's selected **candidate E (velvet bells)** from the
2026-10-05 audition. They are original, project-owned procedural synthesis, not
Kenney samples or another third-party library. No external audio licence or
attribution is required; distributed with this AGPL-3.0 project. Copyrightability
of generated audio depends on applicable law; no exclusive rights are asserted.

| Cue | File | Source |
| --- | --- | --- |
| open | open.ogg | E/open.ogg - rising pair |
| close | close.ogg | E/close.ogg - falling pair |
| move | move.ogg | E/move.ogg - short low wooden tone |
| confirm | confirm.ogg | E/confirm.ogg - octave response |
| cancel | cancel.ogg | E/cancel.ogg - falling response |
| toggle | toggle.ogg | E/toggle.ogg - single tone |
| choice | choice.ogg | E/choice.ogg - soft three-note rise |

Every cue has an E candidate; no substitutions. Files are copied byte-for-byte
from `the author's local audition export`. Synthesis source, provenance and
measurements: `generate.mjs`, `SOURCES.md`, `manifest.json` in that audition folder.
Tools: Node.js and FFmpeg/libopus (tools, not audio sources).

Format: mono 48 kHz Ogg Opus, 96 kb/s; soft attacks and fading tails. Decoded
sample peaks normalized to approximately -6 dBFS (within 0.01 dB) using OpusHead
output gain, with Ogg CRC recalculated and FFmpeg decode verification. This is
sample-peak normalization, not LUFS or true-peak normalization. No further gain
change is applied to these shipped bytes. The mixer defaults to UI 50%, master
80%, with existing per-cue attenuation; saved preferences are never overwritten.
