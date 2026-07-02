import { eq } from 'drizzle-orm';
import { db, defects } from '../../db/index.js';
import { httpError } from '../../lib/http-error.js';

type DefectRow = typeof defects.$inferSelect;

// Loads a defect or throws 404. Callers guard the transition against the returned status, then
// write with a WHERE status = <loaded status> so a concurrent transition is caught (0 rows).
export const loadDefect = async (id: string): Promise<DefectRow> => {
  const [row] = await db.select().from(defects).where(eq(defects.id, id)).limit(1);
  if (!row) {
    throw httpError(404, 'DEFECT_NOT_FOUND', `Defect ${id} not found`);
  }
  return row;
};
