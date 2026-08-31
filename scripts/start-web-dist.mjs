import { resolve } from "node:path";

process.env.LUG_WEB_ROOT = resolve(import.meta.dirname, "..", "apps", "web", "dist");
await import("../apps/web/server.js");
