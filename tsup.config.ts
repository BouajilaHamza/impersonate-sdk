import { defineConfig } from "tsup";

export default defineConfig([
  // Core (zero deps)
  {
    entry: { "core/index": "src/core/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    clean: true,
    outDir: "dist",
  },
  // React bindings
  {
    entry: { "react/index": "src/react/index.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    outDir: "dist",
    external: ["react", "@sylergydigital/impersonate-sdk"],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  // Router handoff hooks (one per router)
  {
    entry: { "react/router/react-router": "src/react/router/react-router.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    outDir: "dist",
    external: ["react", "react-router"],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  {
    entry: { "react/router/next": "src/react/router/next.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    outDir: "dist",
    external: ["react", "next", "next/navigation"],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  {
    entry: { "react/router/tanstack": "src/react/router/tanstack.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    outDir: "dist",
    external: ["react", "@tanstack/react-router"],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  // Supabase + React convenience bundle
  {
    entry: { "supabase-react": "src/supabase-react.ts" },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    outDir: "dist",
    external: ["react", "@supabase/supabase-js"],
    esbuildOptions(options) {
      options.jsx = "automatic";
    },
  },
  // Adapters
  {
    entry: {
      "adapters/supabase": "src/adapters/supabase.ts",
      "adapters/generic": "src/adapters/generic.ts",
    },
    format: ["esm", "cjs"],
    dts: true,
    sourcemap: true,
    outDir: "dist",
    external: ["@supabase/supabase-js"],
  },
]);
