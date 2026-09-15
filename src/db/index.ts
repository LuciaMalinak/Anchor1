import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL is not set");
}

// A small connection pool is plenty for an MVP; postgres-js handles
// pooling for us.
const client = postgres(connectionString, { max: 10 });

export const db = drizzle(client, { schema });

// Exposed so the one-time /api/admin/bootstrap-db route (see that file's
// comment for why it exists) can run raw multi-statement DDL. Not used
// anywhere else in the app.
export const rawClient = client;
