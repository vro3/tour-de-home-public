# Release acceptance evidence

This experimental release includes Race Yourself, original FIT activity import, and read-only FTMS treadmill sync. The source passed 195 tests across 27 test files on Node 24.15.0. Both root and project-subpath production builds passed.

The browser acceptance flow exercised a simulator ride, ghost selection, pause, reload, reconnect, resume, FIT/TCX download validation, original FIT import, duplicate import, saved imported activity selection, treadmill speed-to-distance comparison, belt stop, stale telemetry, and running summary. A synthetic FIT fixture contains 40 elapsed seconds and 20 active seconds; its pause is excluded from comparison. The treadmill uses an isolated FTMS device double. No physical hardware or Strava upload acceptance is claimed.

Forced-browser-crash recovery retained all 3 committed samples, completed with 5 samples after resuming, cleared the active journal, and did not show recovery again after finishing. Narrow screens and 200% text were checked. No uncaught page exceptions or local missing assets occurred on the accepted flow.

## Public source checks

The public release is copied through the explicit source allowlist, with fresh project-authored Git history. Personal author names and email addresses, private development history, local machine paths, settings, logs, and recorded personal activities are excluded. Original image metadata is removed without changing image pixels. Required third-party author and license credits remain.

Every public asset has a provenance entry and SHA-256 hash. SOURCE-MANIFEST.json covers the distributed source files. Gitleaks checks the prepared source and fresh Git history for matching secrets; scanners cannot establish an absolute guarantee of absence.

The runtime dependency audit reported zero findings at preparation. Existing development-tool advisories are described in SECURITY.md. Physical trainer/treadmill acceptance remains outstanding; follow HARDWARE-TEST.md. The optional Map3D bundle still produces a size warning. No live basemap-provider or external fitness-platform acceptance is implied by isolated browser tests.

## Reproduce

Follow the README's installation and verification commands. Browser tests use isolated profiles and synthetic data, write ignored artifacts under artifacts/browser/, and block external browser requests. Use the public GitHub Actions check on the exact commit to inspect hosted results.
