import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { publicFiles } from './release-files.mjs';

const files = await publicFiles();
const inventory = JSON.parse(await readFile('docs/asset-inventory.json', 'utf8'));
assert.deepEqual(files.filter(f => f.startsWith('public/')).sort(), inventory.map(a => a.path).sort(), 'Every public file needs an asset inventory entry.');
for (const asset of inventory) {
  assert.equal(asset.license, asset.path === 'public/THIRD-PARTY-NOTICES.txt' ? 'Upstream licenses' : 'MIT', `Unreviewed asset license: ${asset.path}`);
  assert.equal(createHash('sha256').update(await readFile(asset.path)).digest('hex'), asset.sha256, `Asset changed without provenance review: ${asset.path}`);
}
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
assert.equal(pkg.license, 'MIT');
assert.ok(!Object.keys(lock.packages).some(p => p.includes('@garmin/fitsdk')), 'The public release must not bundle the restricted SDK.');
assert.equal(lock.packages[''].license, pkg.license);
for (const file of files) {
  assert.ok(!/course-library\/gpx\/|scenic\/[^/]*horizon|\.env(?:\.|$)|\.log$/.test(file), `Private or unreviewed file: ${file}`);
  if (!/\.(?:tsx?|mjs|js|json|html|md|yml|css|svg)$/.test(file)) continue;
  const content = await readFile(file, 'utf8');
  assert.ok(!/(?:\/Users\/|\/home\/)[a-zA-Z0-9_-]+\//.test(content), `Machine-specific path in ${file}`);
  assert.ok(!/appgprj_[a-zA-Z0-9]+/.test(content), `Owner-specific hosting ID in ${file}`);
}
console.log(`Release boundary verified: ${files.length} files, ${inventory.length} inventoried assets.`);
