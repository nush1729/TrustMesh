import { Pool } from "pg";
import { config } from "../config";

export const pool = new Pool({ connectionString: config.databaseUrl });

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
