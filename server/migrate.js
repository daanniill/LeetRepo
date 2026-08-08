import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { loadConfig } from "./config.js";
import { createPool } from "./database.js";

const config = loadConfig();
const pool = createPool(config);
const schemaUrl = new URL("./schema.sql", import.meta.url);

try {
  const schema = await readFile(fileURLToPath(schemaUrl), "utf8");
  await pool.query(schema);
  process.stdout.write("Database schema is up to date.\n");
} finally {
  await pool.end();
}

