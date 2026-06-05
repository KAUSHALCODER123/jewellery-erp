import { db } from "../db/client.js";
import { auditLogs } from "../db/schema.js";

export function logAction(
  userId: number,
  action: string,
  table: string,
  recordId: number | null,
  oldVal: unknown,
  newVal: unknown
) {
  try {
    db.insert(auditLogs)
      .values({
        user_id: userId,
        action,
        target_table: table,
        record_id: recordId,
        old_values: stringifyAuditValue(oldVal),
        new_values: stringifyAuditValue(newVal)
      })
      .run();
  } catch (error) {
    console.error("Failed to write audit log", error);
  }
}

function stringifyAuditValue(value: unknown) {
  if (value === undefined || value === null) {
    return null;
  }

  return JSON.stringify(value);
}
