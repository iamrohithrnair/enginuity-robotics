import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
   
  globalIgnores([
     
    ".next/**",
     
    ".next-*/**",
    ".agents-data/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
     
    "data/**",
    "research/evidence/**",
     
    "public/sim-viewer/**",
  ]),
]);

export default eslintConfig;
