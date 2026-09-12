import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `web` is a bun workspace member, so its dependencies are hoisted into the repo
  // root's `node_modules` — including the `next` runtime itself. The tracing root has
  // to be the repo root, or the serverless bundle ships without the files the launcher
  // requires and every API route answers 500 with
  // "Cannot find module 'next/dist/compiled/source-map'".
  //
  // On Vercel that works because the project's root directory is `web` while the whole
  // repository is checked out, so `..` is the repo root (`/vercel/path0`). Deploying
  // with `vercel deploy` *from inside `web/`* uploads only this directory, which makes
  // `..` `/vercel` and nests the build output one level too deep — so deploy through the
  // git integration (push to `main`), not from the CLI inside `web/`.
  outputFileTracingRoot: path.join(__dirname, ".."),

  eslint: {
    dirs: ["app", "components", "lib", "scripts", "test"],
  },

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), payment=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
