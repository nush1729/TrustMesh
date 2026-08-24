import * as fs from "fs";
import * as path from "path";
import { pool } from "./client";

async function migrate() {
  const schemaPath = path.join(__dirname, "schema.sql");
  const schema = fs.readFileSync(schemaPath, "utf-8");
  await pool.query('CREATE EXTENSION IF NOT EXISTS "pgcrypto";'); // for gen_random_uuid()
  await pool.query(schema);
  console.log("Schema applied.");
  await pool.end();
}

migrate().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
