import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const target = resolve(process.cwd(), "data-e2e");
const root = resolve(process.cwd());
if (target !== root && (target.startsWith(`${root}\\`) || target.startsWith(`${root}/`))) {
  await rm(target, { recursive: true, force: true });
}
