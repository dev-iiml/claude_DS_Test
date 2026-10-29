/**
 * The deployment environment (pure; no Node/Next imports). `APP_ENV` decides
 * whether development conveniences apply (dev-only keys, loosened limits,
 * insecure cookies). When it is missing, a production build
 * (`NODE_ENV=production`) is treated as production — fail closed — so a deploy
 * that forgets APP_ENV never runs with development keys.
 */
export type AppEnv = "development" | "test" | "staging" | "production";

export function appEnvOf(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.APP_ENV || (env.NODE_ENV === "production" ? "production" : "development");
}

export function isDevOrTest(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const app = appEnvOf(env);
  return app === "development" || app === "test";
}
