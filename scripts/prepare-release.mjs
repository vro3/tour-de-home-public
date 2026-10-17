import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { publicFiles } from './release-files.mjs';

// Never overwrite an existing release; its verification and history may matter.
const destination = path.resolve(process.argv[2] ?? '.release/tour-de-home');
if (destination === process.cwd()) throw new Error('Choose a new output directory.');
execFileSync(process.execPath, ['scripts/check-release.mjs'], { stdio: 'inherit' });
await mkdir(path.dirname(destination), { recursive: true });
await mkdir(destination);
const hashes = [];
for (const file of await publicFiles()) {
  const target = path.join(destination, file);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(file, target);
  hashes.push({ path: file, sha256: createHash('sha256').update(await readFile(target)).digest('hex') });
}
await writeFile(path.join(destination, 'SOURCE-MANIFEST.json'), JSON.stringify(hashes, null, 2) + '\n');
console.log(`Prepared ${hashes.length} files in ${destination}. No Git history, private courses, or owner hosting configuration was copied.`);
