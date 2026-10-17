# Asset provenance and redistribution

The original project code, synthetic routes, logo, and reviewed generated scenic assets are offered under the root MIT license by the Tour de Home contributors. Third-party software notices and externally requested maps retain their own terms. The exact public-file inventory and SHA-256 hashes are in `asset-inventory.json`.

| Material | Source and evidence | Public release decision |
| --- | --- | --- |
| Three sample GPX courses | Mathematical generation in `scripts/generate-sample-courses.mjs`; not downloaded or recorded | Included, MIT; fictional navigation geometry |
| Four built-in presets | Mathematical segment recipes in `src/route/presets.ts` | Included, MIT; explicitly simulated |
| `public/tour-de-home.svg` | Original project vector logo | Included, MIT |
| `docs/images/demo-ride.png` | Screenshot of this release running its simulator with the included scenery | Included as project documentation; dependency notices still apply |
| 16 panoramic sky WebPs and 16 biome WebPs | Project generation record dated 20 August 2026: original environment prompts, no image reference, no named franchise or artist | Included, MIT to the extent the maintainer holds rights |
| Individual scenery props | Generation records dated 21 August 2026: individual RGBA outputs, original generic descriptions, no reference images; project conversion/cropping | Included with the same terms |
| Third-party dependency code | Exact locked versions and licenses in `dependency-licenses.json`; upstream text in the public notices file | Installed from package registries; notices accompany static builds |

These provenance conclusions rely on the project's creation records and source inspection; they are not a claim of independent legal clearance. Generated artwork is not represented as exclusive. Historical internal asset/theme identifiers are retained to preserve saved preferences and do not imply affiliation or copied game content.

## Generated scenery record

The panorama instructions requested original 2:1 equirectangular environments: a maritime morning, glacial basin, frozen moonlit night, polar tundra, alpine fjord, copper ravine, rainy city, and tropical promenade. They excluded roads/foreground characters, logos, identifiable franchise architecture, named artists, recognizable landmarks, and copied map layouts. No reference images were provided for the included panoramas or props.

Biomes and individual props were generated as isolated trees, rocks, ground cover, generic urban fixtures, and waterfall effects. Source RGBA images were cleaned and converted into high/low WebP variants. The public inventory names every distributed file and its provenance group. Only reviewed assets are included.

## External map sources

Map view requests [OpenFreeMap](https://openfreemap.org/) styles and tiles based on OpenStreetMap/OpenMapTiles; MapLibre displays their supplied attribution. Terrain tiles come from the [AWS Terrain Tiles dataset](https://registry.opendata.aws/terrain-tiles/) maintained by Mapzen. The terrain attribution links to its [provider credits and licenses](https://github.com/tilezen/joerd/blob/master/docs/attribution.md). These external datasets are not bundled or relicensed as MIT.

## Updating this inventory

Review the creation source, license, and attribution before adding or replacing an asset. Record the file, provenance group, license, and SHA-256 in `asset-inventory.json`. `npm run release:check` fails on extra public files, missing entries, or changed bytes. For dependency changes run `npm run licenses:generate`, then review and update the notices-file hash. Supplemental license copies omitted from npm packages are in `docs/licenses/`, with their sources and hashes recorded alongside them.
