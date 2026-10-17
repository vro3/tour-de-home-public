# Architecture

Tour de Home is a static React/TypeScript application built with Vite. It has no server-side account or ride database.

| Module | Responsibility |
| --- | --- |
| `src/App.tsx` | Ride lifecycle, control intent, UI state, persistence coordination |
| `src/ble/` | FTMS telemetry/control, heart-rate service, mock trainer |
| `src/route/` | GPX normalization, elevation smoothing, route interpolation, synthetic presets |
| `src/physics/virtualSpeed.ts` | Power/gradient-based virtual speed |
| `src/ride/ghostRace.ts` | Exact-course matching, active-time replay, and same-distance time gaps |
| `src/storage/rideHistory.ts` | Browser-local completed ride discovery and opponent recovery |
| `src/ride/rideSafety.ts` | Reject stale telemetry for ride progression |
| `src/storage/` | IndexedDB ride journal, completed sessions, selected-route persistence |
| `src/scenic/` and `ScenicRide.tsx` | Procedural scenery, original panoramas/props, rendering quality |
| `src/components/Map3D.tsx` | Optional externally fetched basemap and terrain tiles |
| `src/export/` | FIT and TCX downloads; FIT writer is lazy-loaded |

GPX → validated/smoothed route → interpolated grade and coordinates. Trainer power + grade + rider settings → virtual speed → route progress → recorded sample. Route difficulty changes the resistance command; it does not rewrite geometry or virtual distance.

The FTMS controller serializes commands and waits for control-point indications. Connectivity and control capability are separate. Dropouts pause progression; the UI must not treat a successful telemetry subscription as proof of resistance control. A disconnect can prevent a neutralization command from reaching the trainer.

The ride journal appends samples and checkpoints recovery state. Completed rides remain in the same browser origin. Reloads and browser restarts can recover committed samples; nothing implies synchronization to another machine or host.

Scenic theme IDs and preset IDs are kept stable for saved preferences. Public labels use original names; historical internal IDs are compatibility identifiers. Public artwork includes only the reviewed generated skies/props. Original course/reference archives are excluded from release snapshots.

Runtime dependencies and licenses are recorded in `dependency-licenses.json`. The static bundle carries `THIRD-PARTY-NOTICES.txt`. The release file allowlist lives in `scripts/release-files.mjs`; asset hashes in `asset-inventory.json` make additions and substitutions reviewable.

Race Yourself records fractional `activeTimeSeconds` on each new journal sample. The session stores `raceAgainstId` referencing an immutable completed ride in the same browser database. Pausing checkpoints the current point; recovery retains that clock and opponent without adding wall-clock downtime. Legacy rides with missing timing are not guessed or overwritten. The ghost is a presentation-only replay and never sends trainer commands.

### FIT activity ingestion and treadmill collection

`src/import/fitImport.ts` lazily loads the MIT `fit-file-parser` decoder with CRC validation and strict file boundaries. SHA-256 content IDs deduplicate imports. Single-session timer intervals must agree with summary time, and timestamped distance records must be monotonic. The converter emits the same `SavedRideSession` used by Race Yourself and saves through `rideHistory` only after validation. The input file is not uploaded or retained as raw bytes. Indoor routes carry `synthetic: true`, which prevents fictional GPS from entering FIT/TCX exports.

`FtmsTreadmill` implements the existing trainer interface as a running, telemetry-only device. It subscribes exclusively to Treadmill Data, retains optional incline/heart-rate fields across split packets, and never refreshes speed freshness from a packet without speed. The app integrates measured speed with the active clock and pauses on stopped/stale telemetry. Reconnect generations prevent cancelled retry loops from reviving a disconnected collector. Saved session sport defaults to cycling for legacy data, while new treadmill activities persist running through recovery and export.

FIT timer semantics follow [Garmin's Activity File specification](https://developer.garmin.com/fit/articles/file-types/activity.html). Treadmill decoding follows the Bluetooth SIG [Treadmill Data characteristic definition](https://raw.githubusercontent.com/oesmith/gatt-xml/master/org.bluetooth.characteristic.treadmill_data.xml). These references informed implementation; no SDK or specification text is redistributed.
