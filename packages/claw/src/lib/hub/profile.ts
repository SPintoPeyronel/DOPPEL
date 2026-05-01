/**
 * Merge hub agent profile into config (and optionally store).
 * Call after fetchAgentProfile on bootstrap so the loop and agents use profile-driven settings.
 */

import type { ClawConfig } from "../config/index.js";
import type { HubCoarseActivity } from "../state/index.js";
import { requestAutonomousWakeNow } from "../wake.js";
import type { HubAgentProfile, HubAgentStateResult } from "./hub.js";
import type { ClawStore } from "../state/index.js";

/**
 * Canonical default block from hub agent profile (DB-backed fields).
 * Order: `default_space_id` → top-level `defaultBlockId` → nested `defaultBlock.blockId`.
 * All of these take precedence over process `BLOCK_ID` merged into {@link ClawConfig.blockId}.
 */
export function getProfileCanonicalBlockId(profile: HubAgentProfile | undefined): string | null {
  if (!profile) return null;
  const spaceId =
    typeof profile.default_space_id === "string" ? profile.default_space_id.trim() : "";
  if (spaceId) return spaceId;
  const top =
    typeof profile.defaultBlockId === "string" && profile.defaultBlockId.trim() !== ""
      ? profile.defaultBlockId.trim()
      : "";
  if (top) return top;
  const nested =
    profile.defaultBlock &&
    typeof profile.defaultBlock.blockId === "string" &&
    profile.defaultBlock.blockId.trim() !== ""
      ? profile.defaultBlock.blockId.trim()
      : "";
  return nested || null;
}

/**
 * Apply hub profile to config (mutates config).
 * Sets voiceEnabled, voiceId, dailyCreditBudget, soul; when hub has hosted, can set config.hosted.
 */
export function applyHubProfileToConfig(config: ClawConfig, profile: HubAgentProfile): void {
  if (typeof profile.voiceEnabled === "boolean") config.voiceEnabled = profile.voiceEnabled;
  if (profile.voiceId !== undefined) config.voiceId = profile.voiceId ?? null;
  if (typeof profile.dailyCreditBudget === "number" && profile.dailyCreditBudget >= 0) {
    config.dailyCreditBudget = profile.dailyCreditBudget;
  }
  if (profile.soul !== undefined) config.soul = profile.soul ?? null;
  if (typeof profile.hosted === "boolean") config.hosted = profile.hosted;
  if (typeof profile.id === "string") config.agentId = profile.id;
  const canonicalBlock = getProfileCanonicalBlockId(profile);
  if (canonicalBlock) config.blockId = canonicalBlock;
}

/**
 * Update store with cached balance (e.g. after checkBalance or reportUsage).
 */
export function setCachedBalance(store: ClawStore, balance: number): void {
  store.setCachedBalance(balance);
}

/**
 * When companion hub activity changes, drop movement/cooldown gates so the behaviour tree can
 * pick a new wander target (explore/training/build) or social seek (conversation) on the next tick,
 * and request an autonomous wake (unless owner/cron wake is already pending).
 */
function onCompanionHubActivityChanged(
  store: ClawStore,
  config: ClawConfig,
  prevActivity: HubCoarseActivity,
  nextActivity: HubCoarseActivity
): void {
  if (config.agentType !== "companion") return;
  if (prevActivity === nextActivity) return;

  const s = store.getState();
  if (s.conversationPhase === "idle") {
    store.setMovementTarget(null);
    store.setFollowTargetSessionId(null);
    store.setMovementIntent(null);
    store.setPendingGoTalkToAgent(null);
    store.setAutonomousGoal("wander");
    store.setAutonomousTargetSessionId(null);
    store.setLastSocialSeekTargetSessionId(null);
  }
  store.setNextAutonomousMoveAt(0);
  store.setSocialSeekCooldownUntil(0);
  store.setConversationEndedSeekCooldownUntil(0);
  store.setAutonomousSeekCooldownUntil(0);

  requestAutonomousWakeNow(store, config);
}

/**
 * Apply successful GET /api/agents/me/state to store + config (credits cache, agent kind, companion activity window).
 */
export function applyHubAgentState(
  store: ClawStore,
  config: ClawConfig,
  state: Extract<HubAgentStateResult, { ok: true }>
): void {
  if (state.defaultBlockId != null && state.defaultBlockId.trim() !== "") {
    config.blockId = state.defaultBlockId.trim();
  }
  config.agentType = state.agentType;
  const endMs =
    state.activityEndDate != null ? Date.parse(state.activityEndDate) : Number.NaN;
  const prevActivity = store.getState().hubCoarseActivity;
  const nextActivity = state.currentActivity;
  store.setState({
    cachedBalance: state.credits,
    hubCoarseActivity: nextActivity,
    hubActivityEndAtMs: Number.isFinite(endMs) ? endMs : 0,
    ...(prevActivity !== nextActivity
      ? { nextActivityGlobalBlurbAt: 0, nextTrainingSpellcastEmoteAt: 0 }
      : {}),
  });
  onCompanionHubActivityChanged(store, config, prevActivity, nextActivity);
}
