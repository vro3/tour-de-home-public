# Physical trainer acceptance

**Status: not performed for this release candidate.** Automated tests use a mock or synthetic Bluetooth characteristics. A passing test does not prove a KICKR CORE or another FTMS trainer's physical behavior.

Record the release commit, trainer model, firmware, OS, browser version, tester, and date. Use a short low-effort ride, keep the trainer manufacturer's stop procedure available, and stop pedaling if resistance behaves unexpectedly. Do not intentionally induce a dropout under heavy load.

| Check | Expected observation | Result |
| --- | --- | --- |
| Pair from a fresh page | Browser chooser opens only after clicking; selected trainer connects | Not tested |
| Deny/cancel pairing | Clear feedback, no claimed connection, demo still available | Not tested on hardware |
| Control acquisition | Badge reports resistance ready only after control succeeds | Not tested |
| Route mode, mild flat/up/down grades | Resistance changes consistently; displayed route progress remains plausible | Not tested |
| ERG at two comfortable targets | Measured power settles near the requested targets; record tolerance and time | Not tested |
| Pause, Home, Finish | Resistance neutralization is felt and recording stops/finishes as intended | Not tested |
| Intentional disconnect at rest | No claimed resistance control remains | Not tested |
| Low-load dropout and reconnect | Ride pauses; no stale power advances it; control returns only after reconnection, riding resumes explicitly | Not tested |
| Resume after browser restart | Saved committed samples recovered; explicit pairing/resume required | Not tested on hardware |
| FIT/TCX export to a chosen fitness service | Uploaded distance, timing, power, cadence, and optional heart rate are plausible | Not uploaded |

Do not describe a physical dropout as guaranteed neutralization: the application cannot send a command over a lost connection. Record any command rejection, unsupported ERG/simulation capability, or telemetry-only behavior. Keep personal exports and raw device logs out of public issues unless reviewed and redacted.

## FTMS treadmill acceptance (physical check outstanding)

Record the treadmill make/model/firmware, browser/OS, and tested source revision. Verify standard 0x1826 / 0x2ACD support first. Compare 3, 6, and 9 km/h console speeds with app speed and distance over a timed interval, and verify optional incline and heart rate. Confirm course slope does not change belt settings. Use the console/safety key for all belt control.

With an imported paused FIT run selected as ghost, verify belt zero, manual app pause, dropped Bluetooth, stale notifications, reconnect, browser reload, and explicit Resume. The gap and active clock must freeze during app pauses. A fresh moving speed is required to resume. A telemetry timeout is 2.5 seconds, so unexpected silence can be detected only after that interval. Confirm app Pause/Finish/close never sends a belt-control command. Finish, export, and verify running/treadmill sport and pause times on the destination platform. Do not claim physical acceptance from the software FTMS double alone.
