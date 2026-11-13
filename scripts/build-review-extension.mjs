import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
// Reuse the shipped evidence collector, without bundling any host APIs.
const source = readFileSync("electron/web-review/inject.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
writeFileSync(
  "extensions/deck-review/capture.js",
  context.exports.reviewInjection("#6f9cff") + ";\n",
);
