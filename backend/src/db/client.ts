import { Pool } from "pg";
import { config } from "../config";

export const pool = new Pool({ connectionString: config.databaseUrl });

// Without this listener, `pg` emits 'error' on an idle client whenever the
// connection drops for any reason (DB restart, network blip) and Node
// treats an unhandled 'error' event as fatal — crashing the whole process
// rather than just failing whichever request was mid-query. Logging and
// swallowing it here lets `pool.query()` itself surface the failure to its
// caller as a normal rejected promise instead.
pool.on("error", (err) => {
  console.error("[pg pool] unexpected error on idle client:", err.message);
});

export async function query<T = any>(text: string, params?: any[]): Promise<T[]> {
  const result = await pool.query(text, params);
  return result.rows as T[];
}
