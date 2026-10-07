#!/usr/bin/env node
// Offline, pinned import. No package lifecycle scripts or dependency installation.
// Usage: node scripts/sync-workout-motion.mjs --source /path/to/workout-motion --revision <40-character-commit>
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const websiteRoot = fileURLToPath(new URL('../', import.meta.url));
const upstreamUrl = 'https://github.com/februarysea/workout-motion';
const legalFiles = ['LICENSE', 'NOTICE', 'COMMERCIAL-LICENSE.md'];
const metadataFiles = ['package.json', 'tsconfig.json', ...legalFiles, 'README.md', 'README.zh-CN.md'];
const trainingIds = ['bench-press', 'overhead-press', 'landmine-press', 'pull-up', 'hang-clean', 'squat', 'romanian-deadlift'];
const sha256 = (data) => createHash('sha256').update(data).digest('hex');

function parseArguments() {
  const args = process.argv.slice(2);
  const values = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    if (!['--source', '--revision'].includes(key) || !args[index + 1] || values[key]) {
      throw new Error('Usage: node scripts/sync-workout-motion.mjs --source <local-repository> --revision <40-character-commit>');
    }
    values[key] = args[index + 1];
  }
  if (!values['--source'] || !/^[a-f0-9]{40}$/.test(values['--revision'] ?? '')) {
    throw new Error('Provide a local --source repository and an explicit lowercase 40-character --revision commit SHA.');
  }
  return { source: resolve(values['--source']), revision: values['--revision'] };
}

async function filesUnder(directory, prefix = '') {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await filesUnder(join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
    else throw new Error(`Unexpected non-regular output: ${relative}`);
  }
  return files.sort();
}

async function replaceDirectory(staged, target) {
  const backup = `${staged}-previous`;
  let hadPrevious = false;
  try {
    await rename(target, backup);
    hadPrevious = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await rename(staged, target);
  } catch (error) {
    if (hadPrevious) await rename(backup, target);
    throw error;
  }
  if (hadPrevious) await rm(backup, { recursive: true, force: true });
}

async function main() {
  const { source, revision } = parseArguments();
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { maxBuffer: 16 * 1024 * 1024 });
  const resolvedRevision = git('rev-parse', '--verify', `${revision}^{commit}`).toString().trim();
  if (resolvedRevision !== revision) throw new Error('Revision must identify the exact commit, not a tag.');

  // Read Git blobs rather than working files, excluding local edits and private inputs.
  const tracked = git('ls-tree', '-r', '-z', revision).toString().split('\0').filter(Boolean);
  const inputs = new Map();
  for (const entry of tracked) {
    const separator = entry.indexOf('\t');
    const [mode, type, objectId] = entry.slice(0, separator).split(' ');
    const path = entry.slice(separator + 1);
    if (!metadataFiles.includes(path) && !/^src\/(?:[^/]+\/)*[^/]+\.ts$/.test(path)) continue;
    if (!['100644', '100755'].includes(mode) || type !== 'blob' || path.split('/').includes('..')) {
      throw new Error(`Expected a regular tracked input: ${path}`);
    }
    inputs.set(path, git('cat-file', 'blob', objectId));
  }
  for (const path of [...metadataFiles, 'src/h2.ts']) {
    if (!inputs.has(path)) throw new Error(`Revision is missing required input: ${path}`);
  }

  const upstreamPackage = JSON.parse(inputs.get('package.json').toString());
  const compilerPackage = JSON.parse(await readFile(join(websiteRoot, 'node_modules/typescript/package.json'), 'utf8'));
  if (upstreamPackage.name !== '@februarysea/workout-motion' || upstreamPackage.type !== 'module') {
    throw new Error('The source must be the workout-motion ES module package.');
  }
  if (compilerPackage.version !== upstreamPackage.devDependencies?.typescript) {
    throw new Error(`Use the existing TypeScript version required by upstream (${upstreamPackage.devDependencies?.typescript}); found ${compilerPackage.version}. No dependencies were installed.`);
  }

  const temporary = await mkdtemp(join(tmpdir(), 'workout-motion-build-'));
  let stagedVendor;
  try {
    for (const [path, contents] of inputs) {
      await mkdir(dirname(join(temporary, path)), { recursive: true });
      await writeFile(join(temporary, path), contents);
    }
    const runtime = join(temporary, 'runtime');
    execFileSync(process.execPath, [join(websiteRoot, 'node_modules/typescript/bin/tsc'), '--project', join(temporary, 'tsconfig.json'), '--outDir', runtime], { cwd: temporary, stdio: 'inherit' });

    const { exerciseIds, getExercise, renderSvg } = await import(pathToFileURL(join(runtime, 'h2.js')).href);
    if (exerciseIds.length !== 29 || trainingIds.some((id) => !getExercise(id))) {
      throw new Error('Expected 29 H2 exercises including all seven training motions. Review the catalog before updating.');
    }
    for (const id of trainingIds) {
      if (!renderSvg(id, { phase: 0.35, size: 80 }).startsWith('<svg')) throw new Error(`SVG render failed: ${id}`);
    }

    const modules = {};
    for (const path of await filesUnder(runtime)) {
      const contents = await readFile(join(runtime, path));
      modules[path] = { bytes: contents.length, sha256: sha256(contents) };
    }
    const totalBytes = Object.values(modules).reduce((total, entry) => total + entry.bytes, 0);
    const manifest = `${JSON.stringify({
      upstreamUrl,
      revision,
      revisionUrl: `${upstreamUrl}/tree/${revision}`,
      package: { name: upstreamPackage.name, version: upstreamPackage.version, license: upstreamPackage.license },
      entry: 'runtime/h2.js',
      localModifications: false,
      build: { node: process.versions.node, typescript: compilerPackage.version, command: 'tsc --project tsconfig.json --outDir runtime' },
      sourceSha256: Object.fromEntries([...inputs].sort(([a], [b]) => a.localeCompare(b)).map(([path, contents]) => [path, sha256(contents)])),
      exerciseCount: exerciseIds.length,
      runtimeBytes: totalBytes,
      modules,
    }, null, 2)}\n`;

    // Publish only after compilation, catalog checks and render checks have passed.
    const vendorParent = join(websiteRoot, 'vendor');
    await mkdir(vendorParent, { recursive: true });
    stagedVendor = await mkdtemp(join(vendorParent, '.workout-motion-next-'));
    await cp(runtime, join(stagedVendor, 'runtime'), { recursive: true });
    for (const path of [...legalFiles, 'README.md', 'README.zh-CN.md']) await writeFile(join(stagedVendor, path), inputs.get(path));
    await writeFile(join(stagedVendor, 'SOURCE.json'), manifest);
    await replaceDirectory(stagedVendor, join(vendorParent, 'workout-motion'));
    stagedVendor = undefined;

    const publicDirectory = join(websiteRoot, 'public/exercises/workout-motion');
    await mkdir(publicDirectory, { recursive: true });
    for (const path of ['LICENSE', 'NOTICE', 'SOURCE.json']) {
      const contents = path === 'SOURCE.json' ? manifest : inputs.get(path);
      const staged = join(publicDirectory, `.${path}.next`);
      await writeFile(staged, contents);
      await rename(staged, join(publicDirectory, path));
    }
    console.log(`Vendored ${exerciseIds.length} H2 motions from ${revision}: ${Object.keys(modules).length} runtime files, ${totalBytes} bytes.`);
    console.log('Runtime: vendor/workout-motion/runtime/h2.js; source and license links: public/exercises/workout-motion/.');
  } finally {
    await rm(temporary, { recursive: true, force: true });
    if (stagedVendor) await rm(stagedVendor, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
