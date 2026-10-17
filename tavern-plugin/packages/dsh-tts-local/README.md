# dsh-tts-local

<!-- private fork: private lifecycle plugin; synthesis belongs to generic dsh-tts. -->

Private lifecycle owner for an independently runnable service. It starts/stops
only its own child and supplies the service's Base URL + API key to
`tts.registerReferenceProvider`. It contains no synthesis adapter, model contract,
voice registry, installation identity, or running-process adoption.

Native settings section: `tts-local`. The settings owner is a required dependency;
auto-start waits for its resolved settings, never an owner-less defaults fallback.

- `providerId`: ordinary provider ID, default `default`; no `local:` prefix.
- `installPath`: absolute subprocess working directory.
- `pythonExecutable`: existing absolute Python executable; no installation/activation.
- `workerScript`: absolute independent service script.
- `modelConfigPath`: absolute service JSON config passed as `--config`.
- `arguments` / `environment`: extra string arguments / environment overrides.
- `readinessTimeoutMs`: default 120000.
- `autoStart`: default **true**; explicit **false** opts out. Evaluated on activation,
  not when settings are saved. Incomplete paths fail before spawning.

The service config supplies `url` (loopback HTTP with explicit port) and `token`.
The plugin maps `token` to the generic provider connection's `key`. It never
rewrites this config or exposes the credential in status/UI.
The independent service owns its model inventory, optional export catalogue and
VRAM policy. Figure reference WAVs/text are supplied by the caller, not looked up
by a global voice ID. The public `dsh-tts` package can connect to the same service
manually without this plugin.

Readiness authenticates `GET /v1/info` (`dsh-tts-reference-v1`). Any occupied port
fails without adopting, spawning or terminating the occupant. Stop requests the
owned service's authenticated `POST /shutdown`, then waits for release; owned
subprocess termination remains the fallback. DSH disposal stops its owned child.
Provider withdrawal revokes active synthesis; loss of dsh-tts does not itself stop
the child, and registration resumes when dsh-tts returns.

Before a separately authorized live settings change: stop writes, back up the
complete native settings and service config to a timestamped location, verify
backup hashes, then use the native settings owner to set `autoStart: true` (unless
explicitly opted out). Old persisted `false` does not become true merely because
the schema default changed. Do not patch live settings files while DSH is running.
No deployment is performed by this source change.

`node build.mjs` generates `lib`; `node build.mjs --check` verifies it. Tests use
fake subprocess handles and isolated fixture servers, never installed models.
