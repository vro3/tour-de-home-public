# Changelog

## Unreleased

- Import original FIT cycling/run activities as a saved course and ghost, with strict timer-pause validation and local-only storage.
- Sync standard FTMS treadmill speed, incline and heart rate without belt control; preserve running sessions through pause/reconnect/recovery and FIT/TCX export.
- Include recorded pauses in FIT exports and omit synthetic indoor geometry from exported GPS. — Race Yourself

- Select one saved attempt on the exact same course, follow its violet ghost in Scenic or Map view, and compare live active-time gaps.
- Preserve the race clock and opponent through pauses, dropouts, and browser recovery. Record fractional active time at each sample and checkpoint pauses.
- Show results at the same distance; identify partial rides and exclude legacy recordings without reliable pause timing.
- Test replay identity, stationary intervals, route matching, repeated reconnects, recovery, and the full saved-ride race flow.

## 0.1.0 — open-source release candidate

- Added MIT licensing, contributor documentation, security guidance, source packaging, asset provenance, and bundled third-party notices.
- Replaced restricted race-course bundles with three original synthetic GPX samples. Preserved import and stable route IDs; clarified simulated preset names.
- Renamed cinematic environments with original names and excluded uncertain background plates. Retained independently generated skies and props.
- Replaced the restrictive FIT SDK with an MIT writer and independent decoder tests. Preserved GPS, elevation, power, cadence, elapsed/active time, and added heart-rate export coverage.
- Fixed keyboard GPX import, oversized/malformed XML handling, library errors/retry, missing measurements, and unsupported-browser feedback.
- Fixed a resume timing race after trainer connection and narrow-screen layout with enlarged text. Browser checks cover interrupted-ride recovery and downloaded exports.
- Made scenic assets work on GitHub Pages subpaths, removed external font requests, made development telemetry opt-in, and added terrain-provider attribution.
- Applied compatible dependency fixes. Runtime audit has no findings; remaining development-tool advisories and untested physical hardware are documented.
