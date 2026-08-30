import { readdirSync, readFileSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const failures = [];

function filesUnder(directory, extension) {
  const absolute = join(root, directory);
  if (!statSafe(absolute)?.isDirectory()) return [];
  const files = [];
  for (const entry of readdirSync(absolute, { withFileTypes: true })) {
    if (entry.name === '__pycache__' || entry.name === 'node_modules') continue;
    const path = join(absolute, entry.name);
    if (entry.isDirectory()) files.push(...filesUnder(relative(root, path), extension));
    else if (!extension || entry.name.endsWith(extension)) files.push(path);
  }
  return files;
}

function statSafe(path) {
  try {
    return statSync(path);
  } catch {
    return null;
  }
}

function checkLineLimit(directory, extension, limit) {
  for (const path of filesUnder(directory, extension)) {
    const lines = readFileSync(path, 'utf8').split(/\r?\n/).length - 1;
    if (lines > limit) {
      failures.push(`${relative(root, path)} has ${lines} lines (limit ${limit})`);
    }
  }
}

function checkExactLineLimit(path, limit) {
  const absolute = join(root, path);
  if (!statSafe(absolute)?.isFile()) return;
  const lines = readFileSync(absolute, 'utf8').split(/\r?\n/).length - 1;
  if (lines > limit) failures.push(`${path} has ${lines} lines (limit ${limit})`);
}

checkLineLimit('apps/api/app', '.py', 350);
checkExactLineLimit('apps/api/app/main.py', 300);
checkLineLimit('apps/web/src', '.js', 220);
checkExactLineLimit('server.js', 140);

const publicRoot = join(root, 'apps', 'web', 'public');
for (const entry of readdirSync(publicRoot, { withFileTypes: true })) {
  if (entry.isFile() && entry.name !== 'favicon.svg') {
    failures.push(`apps/web/public/${entry.name} must be in a named static directory`);
  }
}

for (const path of filesUnder('apps/web/public/js', '.js')) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`${relative(root, path)} failed node --check: ${(result.stderr || result.stdout).trim()}`);
  }
}

for (const required of [
  'apps/web/public/pages/index.html',
  'apps/web/public/css/style.css',
  'apps/web/public/js/store.js',
  'apps/api/app/main.py',
  'apps/api/requirements.txt',
  'packages/contracts/openapi.json',
]) {
  if (!statSafe(join(root, required))?.isFile()) failures.push(`missing ${required}`);
}

for (const forbidden of ['apps/api/src', 'apps/api/server.js']) {
  if (statSafe(join(root, forbidden))) failures.push(`legacy path remains: ${forbidden}`);
}

if (failures.length) {
  console.error('quality: failed');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('quality: ok');
}
