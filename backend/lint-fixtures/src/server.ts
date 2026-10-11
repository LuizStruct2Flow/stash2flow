import { db } from './adapters/db.ts'
import { run } from './application/run.ts'
export const ok = [db, run]
