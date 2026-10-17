// Preserve upstream license text with distributed bundles, and inventory every locked package.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
const inventory = Object.entries(lock.packages).filter(([key]) => key).map(([location, pkg]) => ({
  package: location.split('node_modules/').at(-1), version: pkg.version,
  license: pkg.license ?? 'UNKNOWN', developmentOnly: Boolean(pkg.dev), location,
})).sort((a, b) => a.package.localeCompare(b.package) || a.version.localeCompare(b.version));
const notices = ['TOUR DE HOME — THIRD-PARTY SOFTWARE NOTICES', 'The project license does not replace these upstream licenses.'];
const supplemental = {
  '@nodable/entities': 'nodable-entities',
  '@react-three/fiber': 'react-three-fiber',
  'murmurhash-js': 'murmurhash-js',
};
for (const pkg of inventory.filter(p => !p.developmentOnly)) {
  const dir = pkg.location;
  const names = (await readdir(dir)).filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name));
  if (!names.length && !supplemental[pkg.package]) throw new Error(`No license text found for runtime dependency ${pkg.package}`);
  notices.push(`\n${'='.repeat(72)}\n${pkg.package}@${pkg.version} — ${pkg.license}\n`);
  for (const name of names) notices.push(await readFile(path.join(dir, name), 'utf8'));
  if (!names.length) notices.push(await readFile(`docs/licenses/${supplemental[pkg.package]}.txt`, 'utf8'));
}
await mkdir('docs', { recursive: true });
await writeFile('docs/dependency-licenses.json', JSON.stringify(inventory, null, 2) + '\n');
// Normalize line endings only; preserve every upstream license's wording.
await writeFile('public/THIRD-PARTY-NOTICES.txt', notices.join('\n').replace(/\r\n/g, '\n').trimEnd() + '\n');
console.log(`Inventoried ${inventory.length} dependency versions; preserved runtime license notices.`);
