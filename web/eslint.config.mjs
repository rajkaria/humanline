import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
    ],
  },
  {
    // One-off operator scripts that drive loosely-typed SDK surfaces (IDKit's
    // request builder, ethers' dynamic contract proxies) to produce the evidence
    // in `evidence/`. They are run by hand, never bundled, and never imported by
    // the app — banning `any` here buys nothing and would only invite casts that
    // hide more than they describe. App code keeps the rule.
    files: ["scripts/e2e-*.ts"],
    rules: { "@typescript-eslint/no-explicit-any": "off" },
  },
];

export default eslintConfig;
