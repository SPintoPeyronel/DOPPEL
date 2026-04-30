/**
 * Companion skill-run activity from hub (GET /api/agents/me/state).
 *
 * Hub sets non-idle coarse activity whenever the agent has a **pending** `companion_activity_cycles` row
 * (until the player resolves / “Return” on companion). `activityEndDate` on that response is a soft
 * schedule hint for UI; the claw treats the run as active for behaviour + Cloud Run heartbeat until
 * the hub reports `idle` again (cycle no longer pending).
 */
import type { ClawStore } from "./state/index.js";

/** True while hub reports a pending companion activity (coarse activity ≠ idle). */
export function hubCompanionActivityActive(store: ClawStore): boolean {
  return store.getState().hubCoarseActivity !== "idle";
}
