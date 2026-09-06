import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const packageDir = dirname(fileURLToPath(import.meta.url));
const runtimeOutputFile = resolve(packageDir, "src/generated/browser-export-runtime.txt");
const sanitizerOutputFile = resolve(packageDir, "src/generated/html-sanitizer-runtime.txt");
const pageOutputFile = resolve(packageDir, "src/generated/browser-export-page.js");
const kumoRuntimeOutputFile = resolve(packageDir, "src/generated/gadget-kumo-runtime.txt");
const kumoStylesOutputFile = resolve(packageDir, "src/generated/gadget-kumo-styles.txt");
const graphRuntimeOutputFile = resolve(packageDir, "src/generated/gadget-graph-runtime.txt");
const geoRuntimeOutputFile = resolve(packageDir, "src/generated/gadget-geo-runtime.txt");

const runtimeResult = await build({
  entryPoints: [resolve(packageDir, "browser/browser-export-runtime.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2025",
  minify: true,
  write: false,
});
const pageResult = await build({
  entryPoints: [resolve(packageDir, "browser/browser-export-page.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2025",
  write: false,
});
const sanitizerResult = await build({
  entryPoints: [resolve(packageDir, "browser/html-sanitizer-runtime.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2025",
  minify: true,
  write: false,
});
const kumoRuntimeResult = await build({
  // A wrapper may also install workshop-shared: retain one editor instance per bundle.
  alias: Object.fromEntries(['@codemirror/state', '@codemirror/view', '@codemirror/language', '@lezer/common', '@lezer/highlight', '@lezer/lr'].map(name => [name, fileURLToPath(import.meta.resolve(name))])),
  entryPoints: [resolve(packageDir, "browser/gadget-kumo-runtime.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2025",
  minify: true,
  write: false,
});
const graphRuntimeResult = await build({
  entryPoints: [resolve(packageDir, "browser/gadget-graph-runtime.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2025",
  minify: true,
  write: false,
});
const geoRuntimeResult = await build({
  entryPoints: [resolve(packageDir, "browser/gadget-geo-runtime.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2025",
  minify: true,
  write: false,
});
const kumoRuntimeBytes = kumoRuntimeResult.outputFiles[0].contents;
const graphRuntimeBytes = graphRuntimeResult.outputFiles[0].contents;
const geoRuntimeBytes = geoRuntimeResult.outputFiles[0].contents;
const kumoStylesBytes = readFileSync(fileURLToPath(import.meta.resolve("@cloudflare/kumo/styles/standalone")));
assertContains(kumoRuntimeBytes, ".Kumo=Object.freeze", "Kumo browser runtime");
assertContains(kumoRuntimeBytes, "Button:", "Kumo browser runtime");
assertContains(kumoRuntimeBytes, "Textarea:", "Kumo browser runtime");
assertContains(kumoRuntimeBytes, "BeancountEditor:", "Gadget editor runtime");
assertContains(kumoRuntimeBytes, "cm-tooltip-autocomplete", "Gadget editor autocomplete runtime");
assertContains(kumoRuntimeBytes, "catalogue", "Gadget editor account completion runtime");
assertContains(graphRuntimeBytes, ".GadgetGraph=Object.freeze", "Gadget graph runtime");
assertContains(graphRuntimeBytes, "layoutDirected", "Gadget graph runtime");
assertContains(geoRuntimeBytes, ".GadgetGeo=Object.freeze", "Gadget geo runtime");
assertContains(geoRuntimeBytes, "RouteGlobe:", "Gadget geo runtime");
assertContains(kumoStylesBytes, "--color-kumo-brand", "Kumo standalone styles");
assertContains(kumoStylesBytes, ".bg-kumo-base", "Kumo standalone styles");
writeIfChanged(runtimeOutputFile, runtimeResult.outputFiles[0].contents);
writeIfChanged(sanitizerOutputFile, sanitizerResult.outputFiles[0].contents);
writeIfChanged(pageOutputFile, pageResult.outputFiles[0].contents);
writeIfChanged(kumoRuntimeOutputFile, kumoRuntimeBytes);
writeIfChanged(graphRuntimeOutputFile, graphRuntimeBytes);
writeIfChanged(geoRuntimeOutputFile, geoRuntimeBytes);
writeIfChanged(kumoStylesOutputFile, kumoStylesBytes);

function assertContains(bytes, marker, label) {
  if (!new TextDecoder().decode(bytes).includes(marker)) {
    throw new Error(`${label} is missing expected marker: ${marker}`);
  }
}

function writeIfChanged(outputFile, bytes) {
  const contents = new TextDecoder().decode(bytes);
  if (!existsSync(outputFile) || readFileSync(outputFile, "utf8") !== contents) {
    mkdirSync(dirname(outputFile), { recursive: true });
    writeFileSync(outputFile, contents);
  }
}
