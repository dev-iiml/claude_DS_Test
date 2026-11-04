/**
 * `npm start` (Stage 17): runs the production server the way the container does — the standalone `server.js` —
 * after copying the static assets next to it (the Dockerfile does the same). Local settings come from .env.local /
 * .env; anything already in the environment wins. Listens on 127.0.0.1:$PORT (default 3000).
 */
import { cpSync, existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(".next/standalone");
if (!existsSync(`${root}/server.js`)) {
  console.error("✗ no standalone build — run `npm run build` first");
  process.exit(1);
}
cpSync(".next/static", `${root}/.next/static`, { recursive: true });
if (existsSync("public")) cpSync("public", `${root}/public`, { recursive: true });

// Node gives the LAST --env-file precedence, so .env.local (app settings) goes last.
const envFiles = [".env", ".env.local"].map((f) => resolve(f)).filter((f) => existsSync(f));
const child = spawn(process.execPath, [...envFiles.map((f) => `--env-file=${f}`), "server.js"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, NODE_ENV: "production", PORT: process.env.PORT ?? "3000", HOSTNAME: "127.0.0.1" },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
