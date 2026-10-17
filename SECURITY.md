# Security

This is an experimental, browser-local training application. Security fixes target the current release; there is no long-term support guarantee.

## Reporting

Use the repository's **Security → Report a vulnerability** feature when enabled. If unavailable, contact the owner through the public contact method on their GitHub profile and ask for a private reporting channel. Do not post credentials, personal rides, or an unpublished exploit in a public issue. Include a minimal synthetic reproduction, affected version, browser/OS, and observed impact.

## Boundaries

- Untrusted GPX input is size-limited and XML-validated; custom entities/DTDs are rejected.
- The local development server binds to loopback. Do not expose it to an untrusted network.
- Development telemetry is opt-in, same-origin JSON only, and capped at 4 KB per request. It is absent from production builds.
- Ride recovery and history use this browser origin's IndexedDB. No cloud backup is provided. Export important rides.
- A lost Bluetooth link cannot neutralize hardware. Follow the trainer manufacturer's precautions and stop pedaling on control errors.
- Map providers receive network requests for viewed areas. There is no external analytics or font service.

## Dependency audit — 16 October 2026

Runtime audit after compatible updates: **0 findings** (`npm audit --omit=dev`). The full audit still reports **7 development-tool findings**: 5 high and 2 moderate, tracing to two underlying issues in the Tailwind 3 dependency tree:

- [`braces`: deeply nested pattern denial of service](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), propagated through glob/watch packages.
- [`postcss-selector-parser`: selector parsing denial of service](https://github.com/advisories/GHSA-rj75-hqrm-r3gf), propagated through PostCSS nesting.

These packages process repository-controlled CSS and content globs during development/builds. They are not shipped in the browser runtime. That limits exposure in the deployed static app; it does not make building arbitrary untrusted source safe. Use disposable, unprivileged CI for contributions. npm's proposed resolution is a Tailwind 4 migration, which needs a separate visual compatibility review. The release preserves Tailwind 3 and documents this limitation rather than suppressing the findings.

The previous restrictive Garmin SDK dependency was replaced with an MIT-licensed FIT writer; tests use a separate MIT-licensed decoder. Source snapshots must pass the asset inventory and a redacted secret scan. Scanner results are evidence of the checks performed, not a guarantee that no secret exists.
