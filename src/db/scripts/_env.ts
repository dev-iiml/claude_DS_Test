import { config } from "dotenv";

// Scripts read .env.local first (app settings), then .env.
config({ path: [".env.local", ".env"], quiet: true });

export function requireDatabaseUrl(name = "DATABASE_URL"): string {
  const url = process.env[name];
  if (!url) throw new Error(`${name} is not set (see .env.example)`);
  return url;
}

export function assertNotProduction(action: string) {
  const env = process.env.APP_ENV ?? "development";
  if (env === "production" || env === "staging" || process.env.NODE_ENV === "production") {
    throw new Error(`${action} is disabled when APP_ENV=${env}`);
  }
}

/** Redacts credentials from a connection string for console output. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return "(unparseable url)";
  }
}

/** Staging is public (Stage 17): its demo accounts must not share the well-known local password. */
export function strongStagingPassword(password: string): boolean {
  return password.length >= 20 && !/creatorco-demo/i.test(password);
}
