// Deliberate public source boundary. Never include a private Git directory or old planning archives.
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';

export const releaseRoots = [
  'src', 'tests', 'public', '.github',
  'scripts/generate-sample-courses.mjs', 'scripts/release-files.mjs',
  'scripts/prepare-release.mjs', 'scripts/check-release.mjs', 'scripts/generate-notices.mjs',
  'scripts/verify-ride-recovery.mjs', 'scripts/verify-release-browser.mjs',
  'docs/ARCHITECTURE.md', 'docs/ASSETS.md', 'docs/DEPLOYMENT.md', 'docs/HARDWARE-TEST.md',
  'docs/RELEASE-CHECKS.md', 'docs/asset-inventory.json', 'docs/dependency-licenses.json', 'docs/licenses', 'docs/images',
  'README.md', 'ORIGIN.md', 'LICENSE', 'CONTRIBUTING.md', 'SECURITY.md', 'CHANGELOG.md',
  'package.json', 'package-lock.json', '.node-version', '.gitignore',
  'index.html', 'vite.config.ts', 'tsconfig.json', 'tailwind.config.js', 'postcss.config.js',
];

export async function publicFiles(root = process.cwd()) {
  const files = [];
  async function walk(relative) {
    const info = await lstat(path.join(root, relative));
    if (info.isSymbolicLink()) throw new Error(`Release cannot include symlinks: ${relative}`);
    if (info.isDirectory()) {
      for (const name of (await readdir(path.join(root, relative))).sort()) {
        // Finder/Explorer metadata is machine-local, even inside a source directory.
        if (name === '.DS_Store' || name === 'Thumbs.db' || name.startsWith('._')) continue;
        await walk(`${relative}/${name}`);
      }
    } else if (info.isFile()) files.push(relative);
    else throw new Error(`Unsupported release file: ${relative}`);
  }
  for (const relative of releaseRoots) await walk(relative);
  return files.sort();
}
