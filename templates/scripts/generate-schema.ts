import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";

import { HeroConfigSchema } from "../plugin/config.ts";

const OUT_PATH = resolve(import.meta.dir, "..", "schemas", "hero-schema.json");

const schema = zodToJsonSchema(HeroConfigSchema, {
  name: "HeroConfig",
  $refStrategy: "none",
});

await mkdir(dirname(OUT_PATH), { recursive: true });
await Bun.write(OUT_PATH, `${JSON.stringify(schema, null, 2)}\n`);

console.log(`wrote ${OUT_PATH}`);
