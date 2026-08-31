import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import { build } from "esbuild";

const root = resolve(import.meta.dirname, "..");
const source = join(root, "apps", "web", "public");
const output = join(root, "apps", "web", "dist");
const hash = (value) =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);

function resolveIncludes(html, pagesDirectory, stack = []) {
  return html.replace(
    /<!--\s*@include:\s*([^\s]+)\s*-->/g,
    (_, relativePath) => {
      if (
        !relativePath.startsWith("partials/") ||
        stack.includes(relativePath)
      ) {
        throw new Error(`Invalid or recursive HTML partial: ${relativePath}`);
      }
      const partial = join(pagesDirectory, relativePath);
      if (!existsSync(partial))
        throw new Error(`Missing HTML partial: ${relativePath}`);
      return resolveIncludes(readFileSync(partial, "utf8"), pagesDirectory, [
        ...stack,
        relativePath,
      ]);
    },
  );
}

rmSync(output, { recursive: true, force: true });
cpSync(source, output, { recursive: true });

function contentHash(path) {
  return hash(readFileSync(path));
}

function hashStaticFile(directory, extension) {
  const mappings = new Map();
  for (const name of readdirSync(directory)) {
    if (
      !name.endsWith(extension) ||
      new RegExp(`\\.[a-f0-9]{12}\\${extension}$`).test(name)
    )
      continue;
    const current = join(directory, name);
    const base = name.slice(0, -extension.length);
    const targetName = `${base}.${contentHash(current)}${extension}`;
    const target = join(directory, targetName);
    renameSync(current, target);
    mappings.set(
      `${extension.slice(1)}/${name}`,
      `${extension.slice(1)}/${targetName}`,
    );
  }
  return mappings;
}

const mappings = new Map();
for (const extension of [".css"]) {
  for (const [from, to] of hashStaticFile(
    join(output, extension === ".css" ? "css" : "js"),
    extension,
  ))
    mappings.set(from, to);
}

// Keep relative CSS imports valid after content hashing (for example style.css -> tokens.hash.css).
for (const name of readdirSync(join(output, "css"))) {
  if (!name.endsWith(".css")) continue;
  const path = join(output, "css", name);
  let css = readFileSync(path, "utf8");
  for (const [from, to] of mappings) {
    if (!from.startsWith("css/")) continue;
    css = css.replaceAll(`./${from.slice(4)}`, `./${to.slice(4)}`);
  }
  writeFileSync(path, css);
}

const entrypoints = ["admin", "cabinet", "site-shell"];
const temporary = join(output, "js", ".bundle");
mkdirSync(temporary, { recursive: true });
for (const name of entrypoints) {
  const result = await build({
    entryPoints: [join(source, "js", `${name}.js`)],
    bundle: true,
    format: "esm",
    minify: true,
    target: "es2022",
    outfile: join(temporary, `${name}.js`),
    logLevel: "silent",
  });
  void result;
  const bundled = join(temporary, `${name}.js`);
  const targetName = `${name}.${contentHash(bundled)}.js`;
  renameSync(bundled, join(output, "js", targetName));
  mappings.set(`js/${name}.js`, `js/${targetName}`);
  rmSync(join(output, "js", `${name}.js`), { force: true });
}
rmSync(temporary, { recursive: true, force: true });
for (const [from, to] of hashStaticFile(join(output, "js"), ".js"))
  mappings.set(from, to);

for (const page of readdirSync(join(output, "pages"))) {
  if (!page.endsWith(".html")) continue;
  const path = join(output, "pages", page);
  let html = resolveIncludes(readFileSync(path, "utf8"), join(output, "pages"));
  for (const [from, to] of mappings) {
    html = html.replaceAll(
      new RegExp(`${from.replace(".", "\\.")}(?:\\?[^"' )>]*)?`, "g"),
      to,
    );
  }
  writeFileSync(path, html);
}

// Static assets are immutable after hashing; pre-compress them once during the
// build instead of spending CPU on every request in the Node gateway.
for (const directory of ["css", "js", "assets", "fonts"]) {
  const folder = join(output, directory);
  for (const name of readdirSync(folder)) {
    if (!/\.(?:css|js|svg|json|html)$/.test(name)) continue;
    const path = join(folder, name);
    const bytes = readFileSync(path);
    writeFileSync(
      `${path}.br`,
      brotliCompressSync(bytes, {
        params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
      }),
    );
    writeFileSync(`${path}.gz`, gzipSync(bytes, { level: 9, mtime: 0 }));
  }
}

const size = (directory) =>
  readdirSync(directory).reduce((total, name) => {
    if (name.endsWith(".br") || name.endsWith(".gz")) return total;
    const path = join(directory, name);
    return total + (existsSync(path) ? readFileSync(path).byteLength : 0);
  }, 0);
if (size(join(output, "css")) > 600_000)
  throw new Error("CSS bundle budget exceeded");
console.log(
  `web build: ${relative(root, output)} ready; hashed ${mappings.size} assets`,
);
