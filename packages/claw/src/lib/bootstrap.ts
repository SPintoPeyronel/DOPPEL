/**
 * Bootstrap and session — load config, fetch hub profile, join block, create store.
 * Call bootstrapAgent() then createSession() before starting the runner.
 */

import { loadConfig, type ClawConfig } from "./config/index.js";
import { getAgentProfile, joinBlock, type HubAgentProfile } from "./hub/index.js";
import { applyHubProfileToConfig, getProfileCanonicalBlockId } from "./hub/profile.js";
import { createClawStore, type ClawStore } from "./state/index.js";
import { refreshBalance } from "./credits/index.js";
import { normalizeUrl } from "../util/url.js";

export type BootstrapResult = {
  config: ClawConfig;
  /** Whether hub profile was applied to config. */
  profileApplied: boolean;
  /** Raw profile when fetch succeeded (e.g. defaultBlock, cronTasks). */
  profile?: HubAgentProfile;
};

/**
 * Load config and fetch agent profile from hub; merge profile into config.
 * Call once at startup. Config gets voiceEnabled, dailyCreditBudget, soul, etc. from hub.
 */
export async function bootstrapAgent(): Promise<BootstrapResult> {
  const config = loadConfig();
  const res = await getAgentProfile(config.agentApiUrl, config.apiKey);
  let profileApplied = false;
  let profile: HubAgentProfile | undefined;
  if (res.ok) {
    applyHubProfileToConfig(config, res.profile);
    profileApplied = true;
    profile = res.profile;
  }
  const reportUsage = config.hosted && !config.skipCreditReport;
  const statePoll = config.hosted;
  console.log(
    "[claw] Credits: hosted=%s skipCreditReport=%s → report-usage %s, GET /agents/me/state %s",
    config.hosted,
    config.skipCreditReport,
    reportUsage ? "on" : "off",
    statePoll ? "on" : "off"
  );
  return { config, profileApplied, profile };
}

/**
 * Resolve block id for join: hub DB fields from profile (see {@link getProfileCanonicalBlockId}),
 * then `config.blockId` (typically `BLOCK_ID` env when hub had no default), then fallback.
 */
export function getDefaultBlockId(profile: HubAgentProfile | undefined, config: ClawConfig, fallback: string): string {
  const fromProfile = getProfileCanonicalBlockId(profile);
  if (fromProfile) return fromProfile;
  if (config.blockId) return config.blockId;
  return fallback;
}

export type SessionResult =
  | { ok: true; store: ClawStore; jwt: string; engineUrl: string; blockSlotId: string }
  | { ok: false; error: string };

/**
 * Join a block and create the agent store. Refreshes credit balance by default for hosted agents
 * (so HasEnoughCredits is not stuck on the initial 0 cache). Pass `{ refreshBalance: false }` to skip.
 * Call after bootstrapAgent(); use returned jwt and engineUrl to create and connect the engine client.
 *
 * On success, mutates `config` with the hub join response so catalog/usage match the live session:
 * sets `blockId` to the joined block (so list_catalog uses GET /api/blocks/:id/catalog even when
 * BLOCK_ID was unset), and `engineUrl` to the assigned engine when the hub returns serverUrl.
 */
export async function createSession(
  config: ClawConfig,
  blockId: string,
  options?: { refreshBalance?: boolean }
): Promise<SessionResult> {
  const join = await joinBlock(config.agentApiUrl, config.apiKey, blockId);
  if (!join.ok) return { ok: false, error: join.error };

  config.blockId = join.blockId;
  if (join.serverUrl.trim() !== "") {
    config.engineUrl = normalizeUrl(join.serverUrl);
  }

  const store = createClawStore(join.blockSlotId);
  const shouldRefreshBalance =
    options?.refreshBalance !== false && config.hosted && !config.skipCreditReport;
  if (shouldRefreshBalance) {
    const balanceRes = await refreshBalance(store, config);
    if (balanceRes.ok) {
      const s = store.getState();
      const activityEnd =
        s.hubActivityEndAtMs > 0 ? new Date(s.hubActivityEndAtMs).toISOString() : "—";
      console.log(
        "[claw] Hub agent state:",
        "credits=" + balanceRes.balance.toFixed(2),
        "agentType=" + config.agentType,
        "activity=" + s.hubCoarseActivity,
        "activityEnd=" + activityEnd
      );
    } else {
      console.warn("[claw] Credits: balance fetch failed —", balanceRes.error);
    }
  }
  return {
    ok: true,
    store,
    jwt: join.jwt,
    engineUrl: join.serverUrl,
    blockSlotId: join.blockSlotId,
  };
}
