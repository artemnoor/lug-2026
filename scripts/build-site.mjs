import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.join(projectRoot, 'src');
const outputRoot = path.join(projectRoot, 'dist');
const includePattern = /<!--\s*@include\s+([^]*?)\s*-->/;

function isWithin(parent, child) {
  const relative = path.relative(parent, child);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}

async function expandIncludes(filePath, includeStack = []) {
  const absolutePath = path.resolve(projectRoot, filePath);
  if (absolutePath !== path.join(projectRoot, 'index.html') && !isWithin(sourceRoot, absolutePath)) {
    throw new Error('Include is outside src/: ' + filePath);
  }
  if (includeStack.includes(absolutePath)) {
    throw new Error('Circular include: ' + [...includeStack, absolutePath].map((item) => path.relative(projectRoot, item)).join(' -> '));
  }

  let content = await fs.readFile(absolutePath, 'utf8');
  let match;
  while ((match = includePattern.exec(content))) {
    const includePath = match[1].trim().replaceAll('\\', '/');
    if (!includePath.startsWith('src/')) {
      throw new Error('Include must start with src/: ' + includePath);
    }
    const includedContent = await expandIncludes(includePath, [...includeStack, absolutePath]);
    content = content.slice(0, match.index) + includedContent + content.slice(match.index + match[0].length);
  }
  return content;
}

async function copySourceDirectory(name) {
  const sourcePath = path.join(sourceRoot, name);
  await fs.cp(sourcePath, path.join(outputRoot, name), {
    recursive: true,
    force: true,
    filter: async (entryPath) => {
      if (name !== 'assets' || !['.png', '.jpg', '.jpeg'].includes(path.extname(entryPath).toLowerCase())) return true;
      try {
        await fs.access(path.format({ ...path.parse(entryPath), base: undefined, ext: '.webp' }));
        return false;
      } catch (error) {
        if (error?.code === 'ENOENT') return true;
        throw error;
      }
    },
  });
}

async function cleanOutputDirectory() {
  const resolvedRoot = path.resolve(projectRoot);
  const resolvedOutput = path.resolve(outputRoot);
  if (resolvedOutput !== path.join(resolvedRoot, 'dist') || path.dirname(resolvedOutput) !== resolvedRoot) {
    throw new Error('Refusing to clean an unexpected build output path: ' + resolvedOutput);
  }
  try {
    const outputStat = await fs.lstat(resolvedOutput);
    if (outputStat.isSymbolicLink()) throw new Error('Refusing to clean dist because it is a symbolic link.');
    if (!outputStat.isDirectory()) throw new Error('Refusing to clean dist because it is not a directory.');
    await fs.rm(resolvedOutput, { recursive: true, force: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await fs.mkdir(resolvedOutput, { recursive: true });
}

const sourcePage = await expandIncludes('index.html');
const includedFiles = (sourcePage.match(/<!--\s*@include\s+/g) ?? []).length;
if (includedFiles > 0) throw new Error('Unexpanded includes remain in dist/index.html: ' + includedFiles);

await cleanOutputDirectory();
await fs.writeFile(path.join(outputRoot, 'index.html'), sourcePage, 'utf8');
await fs.copyFile(path.join(sourceRoot, 'register.html'), path.join(outputRoot, 'register.html'));
await Promise.all(['account', 'assets', 'scripts', 'styles'].map(copySourceDirectory));

process.stdout.write('[build] expanded page into dist/index.html (' + Buffer.byteLength(sourcePage) + ' bytes)\n');
