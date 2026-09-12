import path from "node:path";

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // `web` is a bun workspace member, so there is a lockfile here *and* at the
  // repo root. Pin the tracing root to the repo so Next stops guessing.
  //
  // On Vercel only `web/` is uploaded (the project's root directory is the app
  // itself), so the repo root does not exist there: pointing the tracing root
  // at `..` would be `/vercel`, and Next would nest the output one directory
  // deeper than the builder looks for it (`/vercel/path0/path0/.next`).
  outputFileTracingRoot: process.env.VERCEL ? __dirname : path.join(__dirname, ".."),

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
