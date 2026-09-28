import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // desktop/ is a separate Electron/Node project (its own package.json,
    // tsconfig, dependencies — see desktop/README.md) bundled in this
    // same repo, not part of the Next.js app. Linting it with rules
    // meant for React/browser code in src/ produces nothing but false
    // positives (e.g. Node's `require`/Electron globals flagged as
    // undefined) — same reason it's excluded from the root tsconfig.json.
    "desktop/**",
  ]),
]);

export default eslintConfig;
