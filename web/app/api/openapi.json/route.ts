import { NextResponse } from "next/server";

import { CORS_HEADERS } from "@/lib/api/v1";
import { OPENAPI } from "@/lib/api/openapi";

export const dynamic = "force-static";

export function GET() {
  return NextResponse.json(OPENAPI, {
    headers: { ...CORS_HEADERS, "cache-control": "public, max-age=300, s-maxage=3600" },
  });
}
