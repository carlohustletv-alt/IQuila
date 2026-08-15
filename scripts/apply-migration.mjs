import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ quiet: true });

const migrationPath = process.argv[2];

if (!migrationPath) {
  console.error("Usage: node scripts/apply-migration.mjs <path-to-sql-file>");
  process.exit(1);
}

const projectRef = process.env.SUPABASE_URL?.match(/^https:\/\/([a-z0-9]+)\.supabase\.co$/)?.[1];
const connectionString = process.env.DATABASE_URL ?? (
  projectRef && process.env.SUPABASE_DB_PASSWORD
    ? `postgresql://postgres:${encodeURIComponent(process.env.SUPABASE_DB_PASSWORD)}@db.${projectRef}.supabase.co:5432/postgres`
    : undefined
);
const databaseCaPath = process.env.SUPABASE_DB_CA_PATH;

if (!connectionString) {
  console.error("DATABASE_URL or SUPABASE_DB_PASSWORD is required in .env");
  process.exit(1);
}
if (!databaseCaPath) {
  console.error("SUPABASE_DB_CA_PATH is required for certificate-verified database TLS");
  process.exit(1);
}

const databaseCa = await readFile(resolve(databaseCaPath), "utf8");

const client = new pg.Client({
  connectionString,
  ssl: {
    ca: databaseCa,
    rejectUnauthorized: true
  }
});

try {
  const sql = await readFile(resolve(migrationPath), "utf8");
  await client.connect();
  await client.query(sql);
  console.log(`Applied migration: ${migrationPath}`);
} finally {
  await client.end();
}
