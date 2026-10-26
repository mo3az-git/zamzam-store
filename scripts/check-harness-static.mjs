import { ESLint } from "eslint";

// Workspace `eslint .` does not discover .mjs runners by default. Catch
// undefined assertion variables before spending a disposable-service CI run.
const eslint = new ESLint({
  useEslintrc: false,
  baseConfig: {
    env: { es2022: true, node: true },
    parserOptions: { ecmaVersion: "latest", sourceType: "module" },
    rules: { "no-undef": "error" },
  },
});
const results = await eslint.lintFiles(["scripts/**/*.mjs", "apps/backend/scripts/**/*.mjs"]);
const formatted = await (await eslint.loadFormatter("stylish")).format(results);
if (formatted) process.stdout.write(formatted);
const errors = results.reduce((sum, item) => sum + item.errorCount, 0);
console.log(`Harness static check: ${results.length} files, ${errors} errors.`);
process.exitCode = errors ? 1 : 0;
