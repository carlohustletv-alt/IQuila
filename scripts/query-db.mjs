import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import pg from "pg";

loadEnv({ quiet: true });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is required");
  process.exit(1);
}
if (!process.env.SUPABASE_DB_CA_PATH) {
  console.error("SUPABASE_DB_CA_PATH is required for certificate-verified database TLS");
  process.exit(1);
}

const databaseCa = await readFile(resolve(process.env.SUPABASE_DB_CA_PATH), "utf8");

const sql = process.argv.slice(2).join(" ");

if (!sql) {
  console.error("Usage: node scripts/query-db.mjs <sql>");
  process.exit(1);
}

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    ca: databaseCa,
    rejectUnauthorized: true
  }
});

try {
  await client.connect();
  const result = await client.query(sql);
  console.log(JSON.stringify(result.rows, null, 2));
} finally {
  await client.end();
}
