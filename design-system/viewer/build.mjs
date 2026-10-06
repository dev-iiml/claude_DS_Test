/**
 * Builds the design-system preview bundle from the REAL components.
 *
 *   node design-system/viewer/build.mjs
 *
 * Outputs design-system/components/bundle.js (IIFE, global `CreatorCo`, React bundled in;
 * previews call `CreatorCo.mount("<Specimen>")`) and design-system/components/bundle.css
 * (Tailwind compile of src/app/globals.css, scanning src/components and the specimens).
 * next/link and next/navigation are shimmed. Dev-only: not part of the app build.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../..");
const OUT = path.join(REPO, "design-system/components");
const shim = (f) => path.join(HERE, "src/shims", f);

const alias = {
  name: "alias",
  setup(b) {
    b.onResolve({ filter: /^@\// }, (a) =>
      b.resolve("./" + a.path.slice(2), { resolveDir: path.join(REPO, "src"), kind: a.kind }),
    );
    b.onResolve({ filter: /^next\/link$/ }, () => ({ path: shim("next-link.tsx") }));
    b.onResolve({ filter: /^(next\/navigation|server-only)$/ }, () => ({ path: shim("next-navigation.ts") }));
  },
};

await mkdir(OUT, { recursive: true });

await build({
  entryPoints: [path.join(HERE, "src/specimens.tsx")],
  bundle: true,
  minify: true,
  format: "iife",
  globalName: "CreatorCo",
  platform: "browser",
  target: "es2020",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  nodePaths: [path.join(REPO, "node_modules")],
  plugins: [alias],
  outfile: path.join(OUT, "bundle.js"),
  legalComments: "none",
  logLevel: "warning",
});

const globals = await readFile(path.join(REPO, "src/app/globals.css"), "utf8");
const input = [
  '@import "tailwindcss" source(none);',
  `@source "${path.join(REPO, "src/components")}";`,
  `@source "${path.join(HERE, "src")}";`,
  globals
    .replace(/^@import "tailwindcss";\s*$/m, "")
    .replace('@import "./tokens.css";', `@import "${path.join(REPO, "src/app/tokens.css")}";`),
].join("\n");
const css = await postcss([tailwind({ base: REPO, optimize: { minify: true } })]).process(input, {
  from: path.join(REPO, "src/app/globals.css"),
});
await writeFile(path.join(OUT, "bundle.css"), css.css);

const js = await readFile(path.join(OUT, "bundle.js"), "utf8");
if (/<\/script|<!--/i.test(js) || /<\/style/i.test(css.css)) throw new Error("bundle contains a closing tag");
console.log(`bundle.js ${(js.length / 1024).toFixed(0)} KB · bundle.css ${(css.css.length / 1024).toFixed(0)} KB`);
