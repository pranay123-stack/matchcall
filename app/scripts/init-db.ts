// MatchCall — initialize the local SQLite store.
// Run from app/:  npm run db:init
import { initDb, listMarkets } from "../lib/db.js";

initDb();
console.log(`SQLite ready at ${process.env.DATABASE_PATH ?? "./matchcall.db"}. Markets indexed: ${listMarkets().length}`);
