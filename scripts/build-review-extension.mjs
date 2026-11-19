import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import vm from "node:vm";
import { format, resolveConfig } from "prettier";
// Reuse the shipped evidence collector, without bundling any host APIs.
const source = readFileSync("electron/web-review/inject.ts", "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const context = { exports: {} };
vm.runInNewContext(compiled, context);
const outputPath = "extensions/deck-review/capture.js";
const options = await resolveConfig(outputPath);
const injection = context.exports.reviewInjection("#6f9cff");
writeFileSync(outputPath, await format(injection + ";\n", { ...options, filepath: outputPath }));
