import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const sourceExtensions = new Set(['.html', '.css', '.js', '.mjs']);
const mediaExtensions = new Set([
  '.avif',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg',
  '.ttf',
  '.webp',
  '.woff',
  '.woff2'
]);
const reportUnused = process.argv.includes('--report-unused');
const strictUnused = process.argv.includes('--strict-unused');
const verbose = process.argv.includes('--verbose') || process.env.LOG_LEVEL === 'debug';
const references = [];
const missing = [];
const invalid = [];

function addReference(source, rawUrl) {
  const value = rawUrl.trim();

  if (!value || value.startsWith('#') || value.startsWith('//')) return;
  if (/^(?:data|blob|https?|ftp|mailto|tel|javascript):/i.test(value)) return;

  let decodedPath;
  try {
    decodedPath = decodeURIComponent(value.split(/[?#]/, 1)[0]);
  } catch {
    invalid.push({ source, rawUrl, reason: 'invalid percent encoding' });
    return;
  }

  if (!decodedPath) return;
  const normalizedPath = decodedPath.replaceAll('\\', '/');
  if (normalizedPath.startsWith('/')) return;
  const sourcePath = path.resolve(projectRoot, source);
  const browserRootReference = path.extname(sourcePath).toLowerCase() === '.js'
    && /^\.\/(?:assets|scripts|styles)\//i.test(normalizedPath);
  const basePath = browserRootReference ? projectRoot : path.dirname(sourcePath);
  const resolvedPath = path.resolve(basePath, normalizedPath);
  const relativePath = path.relative(projectRoot, resolvedPath);
  if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || path.isAbsolute(relativePath)) {
    invalid.push({ source, rawUrl, reason: 'path escapes the project root' });
    return;
  }

  references.push({ source, rawUrl, resolvedPath });
}

function extractReferences(source, content) {
  const extension = path.extname(source).toLowerCase();
  const attributePattern = /\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
  const cssUrlPattern = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*?))\s*\)/gi;

  if (extension === '.html') {
    for (const match of content.matchAll(attributePattern)) {
      addReference(source, match[1] ?? match[2] ?? '');
    }
  }

  if (extension === '.css') {
    for (const match of content.matchAll(cssUrlPattern)) {
      addReference(source, match[1] ?? match[2] ?? match[3] ?? '');
    }

    const importPattern = /@import\s+(?:url\(\s*)?(['"])([^'"]+)\1\s*\)?/gi;
    for (const match of content.matchAll(importPattern)) {
      addReference(source, match[2]);
    }
  }

  if (extension === '.js' || extension === '.mjs') {
    const modulePattern = /\b(?:import|export)\s+(?:(?:[^'";]*?)\s+from\s*)?(['"])(\.{1,2}\/[^'"]+)\1|\bimport\s*\(\s*(['"])(\.{1,2}\/[^'"]+)\3\s*\)/g;
    for (const match of content.matchAll(modulePattern)) {
      addReference(source, match[2] ?? match[4]);
    }
  }
}

async function inspectSources() {
  const sourceFiles = await findSourceFiles(projectRoot);
  for (const relativeFile of sourceFiles) {
    const sourcePath = path.join(projectRoot, relativeFile);
    let content;

    try {
      content = await fs.readFile(sourcePath, 'utf8');
    } catch (error) {
      missing.push({
        source: relativeFile,
        rawUrl: relativeFile,
        expectedPath: sourcePath,
        reason: error?.code === 'ENOENT' ? 'source file not found' : String(error)
      });
      continue;
    }

    extractReferences(relativeFile, content);
  }

  const checked = new Set();
  for (const reference of references) {
    const key = reference.resolvedPath.toLowerCase();
    if (checked.has(key)) continue;
    checked.add(key);

    try {
      const stat = await fs.stat(reference.resolvedPath);
      if (!stat.isFile()) {
        missing.push({ ...reference, reason: 'path is not a file' });
      } else if (verbose) {
        process.stdout.write('[asset-check] OK ' + reference.source + ' -> ' + reference.rawUrl + '\n');
      }
    } catch (error) {
      missing.push({
        ...reference,
        reason: error?.code === 'ENOENT' || error?.code === 'ENOTDIR'
          ? 'file not found'
          : String(error)
      });
    }
  }
}

async function findSourceFiles(directory) {
  const files = [];
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await findSourceFiles(entryPath));
    } else if (entry.isFile() && sourceExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(path.relative(projectRoot, entryPath));
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

async function findUnusedRootMedia() {
  const referencedPaths = new Set(references.map((reference) => reference.resolvedPath.toLowerCase()));
  const entries = await fs.readdir(projectRoot, { withFileTypes: true });
  const rootMedia = entries
    .filter((entry) => entry.isFile() && mediaExtensions.has(path.extname(entry.name).toLowerCase()))
    .map((entry) => path.join(projectRoot, entry.name))
    .sort((left, right) => left.localeCompare(right));

  return {
    rootMedia,
    unused: rootMedia.filter((filePath) => !referencedPaths.has(filePath.toLowerCase()))
  };
}

await inspectSources();
const { rootMedia, unused } = await findUnusedRootMedia();

for (const issue of invalid) {
  process.stderr.write('[asset-check] INVALID ' + issue.source + ' -> ' + issue.rawUrl + ': ' + issue.reason + '\n');
}

for (const issue of missing) {
  process.stderr.write('[asset-check] MISSING ' + issue.source + ' -> ' + issue.rawUrl
    + ' (' + issue.reason + '): ' + issue.resolvedPath + '\n');
}

if (reportUnused || strictUnused) {
  process.stdout.write('[asset-check] unused root media: ' + unused.length + '\n');
  for (const filePath of unused) {
    process.stdout.write('  ' + path.relative(projectRoot, filePath).replaceAll(path.sep, '/') + '\n');
  }
}

if (strictUnused && rootMedia.length > 0) {
  process.stderr.write('[asset-check] strict check found ' + rootMedia.length + ' media/font file(s) in the project root\n');
}

process.stdout.write('[asset-check] references=' + references.length
  + ', missing=' + missing.length
  + ', invalid=' + invalid.length
  + ', root-media=' + rootMedia.length + '\n');

if (missing.length > 0 || invalid.length > 0 || (strictUnused && rootMedia.length > 0)) {
  process.exitCode = 1;
}
