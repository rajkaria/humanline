import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { OPENAPI } from "@/lib/api/openapi";

const APP = join(import.meta.dir, "..", "app");

describe("OpenAPI document", () => {
  test("every documented path is a real route handler", () => {
    for (const path of Object.keys(OPENAPI.paths)) {
      const file = join(APP, ...path.replace(/^\//, "").split("/").map((s) => s.replace(/^\{(.+)\}$/, "[$1]")), "route.ts");
      expect(existsSync(file)).toBe(true);
    }
    expect(existsSync(join(APP, "api", "openapi.json", "route.ts"))).toBe(true);
  });

  test("every 200 example carries every required field", () => {
    for (const item of Object.values(OPENAPI.paths)) {
      const ok = item.get.responses["200"].content["application/json"];
      for (const key of ok.schema.required) expect(ok.example).toHaveProperty(key);
      const lineSchema = "line" in ok.schema.properties ? ok.schema.properties.line : undefined;
      const exampleLine = (ok.example as { line?: Record<string, unknown> }).line;
      if (lineSchema && exampleLine) {
        const required = "required" in lineSchema ? lineSchema.required : lineSchema.oneOf[0].required;
        for (const key of required) expect(exampleLine).toHaveProperty(key);
      }
    }
  });

  test("is OpenAPI 3.1 with one server", () => {
    expect(OPENAPI.openapi).toBe("3.1.0");
    expect(OPENAPI.servers[0].url).toBe("https://humanline.credit");
  });
});
