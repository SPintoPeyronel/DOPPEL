/**
 * Runner — wires the behaviour tree loop with Obedient and Autonomous agents.
 * Pass a client to run real LLM ticks; omit for a loop that only ticks the tree (stubs).
 *
 * Architecture:
 * - Obedient: owner/scheduled wake → RunObedientAgent (full tools).
 * - Autonomous: BT-driven flow — InConversation → RunConverseAgent (chat-only); else SeekSocialTarget or Wander (no LLM for movement).
 */

import type { DoppelClient } from "@doppelfun/sdk";
import type { Occupant } from "@doppelfun/sdk";
import { buildSystemContent } from "../prompts/index.js";
import { buildUserMessage } from "../prompts/index.js";
import { runObedientAgentTick } from "../agent/obedientAgent.js";
import { runConverseAgentTick } from "../agent/converseAgent.js";
import { drainPendingReply, onWeSentDm } from "../conversation.js";
import { movementDriverTick, CONVERSATION_RANGE_M, DEFAULT_STOP_DISTANCE_M } from "../movement/index.js";
import {
  INSUFFICIENT_CREDITS_REPLY_MESSAGE,
  reportUsageToHub,
  reportVoiceUsageToHub,
  refreshBalance,
} from "../credits/index.js";
import { createAgentLoop, type AgentLoop } from "../tree/index.js";
import type { ClawStore } from "../state/index.js";
import type { ClawConfig } from "../config/index.js";
import type { TreeAction } from "../state/index.js";
import { clawLog } from "../../util/log.js";
import { parseIntEnv } from "../../util/env.js";
import { pickSocialSeekTargetOccupant, pickWanderMoveTargetOccupant } from "../../util/position.js";
import { hubCompanionActivityActive } from "../hubActivity.js";
import { tickActivityGlobalBlurb } from "../activityGlobalBlurb.js";
import { tickTrainingSpellcastEmote } from "../trainingSpellcastEmote.js";

/** Interval (ms) to refresh occupants so myPosition is set and TimeForAutonomousWake can fire when owner is away. */
const OCCUPANTS_REFRESH_MS = 10_000;

/** Interval (ms) to re-fetch GET /api/agents/me/state (credits + agent kind + companion activity). */
const AGENT_STATE_REFRESH_MS = 30_000;

/**
 * When `PORT` is set (Railway / Cloud Run), periodic **inbound** HTTP to the local health listener keeps
 * the platform from treating the service as idle (outbound-only engine WebSocket does not count).
 * Env `CLAW_PLATFORM_INBOUND_HEARTBEAT_MS` — default 120_000, clamped 30_000–600_000.
 */
function parsePlatformInboundHeartbeatPort(): number | null {
  const raw = process.env.PORT?.trim();
  if (!raw) return null;
  const port = Number(raw);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) return null;
  return port;
}

/** Min/max cooldown (ms) before next autonomous move. Shared by move-to-nearest, seek-social, and movement driver on arrival. */
const AUTONOMOUS_MOVE_COOLDOWN_MS = { min: 20_000, max: 45_000 };

/** Cooldown (ms) after starting a social seek before we may seek again. */
const SOCIAL_SEEK_COOLDOWN_MS = 10_000;

/** Shorter cooldown while hub activity is “conversation” so companions keep looking for someone to talk to. */
const SOCIAL_SEEK_CONVERSATION_COOLDOWN_MS = 3_500;

function randomCooldownMs(): number {
  return AUTONOMOUS_MOVE_COOLDOWN_MS.min + Math.random() * (AUTONOMOUS_MOVE_COOLDOWN_MS.max - AUTONOMOUS_MOVE_COOLDOWN_MS.min);
}

type RunTickResult = Awaited<ReturnType<typeof runObedientAgentTick>>;

/** LLM tick label → display name and TreeAction for lastCompletedAction. */
const LLM_TICK_LABELS: Record<"obedient" | "autonomous" | "converse", { displayName: string; completedAction: TreeAction }> = {
  obedient: { displayName: "Obedient", completedAction: "obedient" },
  autonomous: { displayName: "Autonomous", completedAction: "autonomous_llm" },
  converse: { displayName: "Converse", completedAction: "autonomous_converse" },
};

/**
 * Run one agent tick (obedient / converse): build user message, call LLM, report usage,
 * optional fallback: non-empty model text without chat tool, or obedient-only "..." when non-chat tools ran
 * with no visible text. Converse mode never sends "..." (reply is always via chat tool or queue).
 */
async function runAgentTickWithFallback(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  runTick: (client: DoppelClient, store: ClawStore, config: ClawConfig, system: string, user: string) => Promise<RunTickResult>,
  label: keyof typeof LLM_TICK_LABELS,
  onUsageReportFailure?: (message: string) => void
): Promise<void> {
  const { displayName, completedAction } = LLM_TICK_LABELS[label];
  clawLog(`runner: Run${displayName}Agent start`);
  const userContent = buildUserMessage(store, config);
  store.setThinking(true);
  try {
    const result = await runTick(client, store, config, systemContent, userContent);
    const state = store.getState();
    clawLog(
      `runner: ${label} tick done`,
      "ok=" + result.ok,
      "replyText=" + (result.ok && result.replyText ? result.replyText.slice(0, 60) + "…" : "null"),
      "lastTickSentChat=" + state.lastTickSentChat
    );
    if (result.ok && result.usage) {
      reportUsageToHub(config, store, result.usage, config.chatLlmModel, onUsageReportFailure);
    }
    if (result.ok && !state.lastTickSentChat) {
      const raw = typeof result.replyText === "string" ? result.replyText.trim() : "";
      const replyText =
        label === "converse"
          ? raw
          : raw || (result.hadNonChatToolCall ? "..." : "");
      if (replyText) {
        clawLog("runner: sending fallback chat", replyText.slice(0, 80));
        const dmTarget = state.lastDmPeerSessionId ?? undefined;
        const voiceId = config.voiceId ?? undefined;
        client.sendChat?.(replyText, { targetSessionId: dmTarget, voiceId });
        if (voiceId) {
          reportVoiceUsageToHub(config, store, replyText.length, onUsageReportFailure);
        }
        store.setLastAgentChatMessage(replyText);
        store.setLastTickSentChat(true);
        if (dmTarget) onWeSentDm(store, dmTarget);
      }
    }
    if (result.ok) {
      store.clearOwnerMessages();
      store.setLastCompletedAction(completedAction);
    } else {
      store.setCurrentAction("error");
    }
  } finally {
    store.setThinking(false);
  }
}

/**
 * Shared logic: set movement state and call moveTo for a chosen occupant.
 * Used by TryMoveToNearestOccupant (wander) and SeekSocialTarget (approach-for-conversation).
 *
 * @param beforeMove - Optional callback after common state updates (e.g. set autonomousGoal, socialSeekCooldownUntil).
 */
function startMoveToOccupant(
  store: ClawStore,
  client: DoppelClient,
  occupant: Occupant,
  stopDistanceM: number,
  beforeMove?: (store: ClawStore) => void
): void {
  const pos = occupant.position;
  if (!pos) return;
  const now = Date.now();
  store.setMovementIntent(null);
  store.setMovementTarget({ x: pos.x, z: pos.z });
  store.setLastMoveToFailed(null);
  store.setMovementStopDistanceM(stopDistanceM);
  store.setMovementSprint(false);
  store.setAutonomousEmoteStandStillUntil(0);
  store.setNextAutonomousMoveAt(now + randomCooldownMs());
  beforeMove?.(store);
  client.moveTo(pos.x, pos.z);
}

/** True when an engine HTTP error looks like an expired/invalid session or hub JWT. */
function isSessionOrJwtHttpError(message: string): boolean {
  return (
    /\b401\b/.test(message) ||
    /invalid or expired session/i.test(message) ||
    /invalid or expired jwt/i.test(message) ||
    /jwt has expired/i.test(message)
  );
}

/** Options for creating the runner (store, config, optional client and callbacks). */
export type RunnerOptions = {
  store: ClawStore;
  config: ClawConfig;
  /** When provided, Obedient and Autonomous agents run real LLM ticks. When omitted, they are no-ops. */
  client?: DoppelClient | null;
  /** Optional: called every 50ms for movement and draining pending DM. Requires client. */
  executeMovementAndDrain?: () => void;
  /** Optional: called when report-usage fails (e.g. 402 insufficient credits). */
  onUsageReportFailure?: (message: string) => void;
  /**
   * When GET /api/occupants still fails after SDK session retries (expired hub JWT or engine desync),
   * refresh the hub block JWT and reconnect WS (CLI: joinBlock + reconnectNow).
   */
  refreshHubSession?: () => Promise<void>;
};

/**
 * Create the main agent loop with Obedient and Autonomous agents wired to the behaviour tree.
 * Builds system content once; on each wake runs buildUserMessage, then the appropriate agent tick.
 * Sends fallback chat to DM peer when the agent used tools but did not send chat.
 *
 * @param options - Store, config, optional client, executeMovementAndDrain, onUsageReportFailure
 * @returns AgentLoop (start/stop/step) from createAgentLoop
 */
export function createRunner(options: RunnerOptions): AgentLoop {
  const { store, config, client, executeMovementAndDrain, onUsageReportFailure, refreshHubSession } = options;
  const platformInboundHeartbeatPort = parsePlatformInboundHeartbeatPort();
  const platformInboundHeartbeatMs = parseIntEnv(
    "CLAW_PLATFORM_INBOUND_HEARTBEAT_MS",
    120_000,
    30_000,
    600_000
  );
  let lastPlatformInboundHeartbeatAt = 0;
  const clawConfigPrompt = {
    soul: config.soul ?? undefined,
    skills: undefined,
    agentType: config.agentType,
  };
  const systemContent = buildSystemContent(clawConfigPrompt);

  const runObedientAgent =
    client != null
      ? () =>
          runAgentTickWithFallback(
            client,
            store,
            config,
            systemContent,
            runObedientAgentTick,
            "obedient",
            onUsageReportFailure
          )
      : undefined;

  const runConverseAgent =
    client != null
      ? () =>
          runAgentTickWithFallback(
            client,
            store,
            config,
            systemContent,
            runConverseAgentTick,
            "converse",
            onUsageReportFailure
          )
      : undefined;

  const defaultExecuteMovementAndDrain = (): void => {
    if (!client) return;
    if (platformInboundHeartbeatPort != null) {
      const now = Date.now();
      const s = store.getState();
      const keepWarm =
        (config.agentType === "companion" && hubCompanionActivityActive(store)) || s.isThinking;
      if (keepWarm && now - lastPlatformInboundHeartbeatAt >= platformInboundHeartbeatMs) {
        lastPlatformInboundHeartbeatAt = now;
        const url = `http://127.0.0.1:${platformInboundHeartbeatPort}/`;
        void fetch(url, { signal: AbortSignal.timeout(8000) }).catch((e) => {
          clawLog(
            "runner: platform inbound heartbeat failed",
            e instanceof Error ? e.message : String(e)
          );
        });
      }
    }
    movementDriverTick(client, store, {
      voiceId: config.voiceId,
      onVoiceSent:
        config.voiceId
          ? (characters) => reportVoiceUsageToHub(config, store, characters, onUsageReportFailure)
          : undefined,
      ownerUserId: config.ownerUserId ?? undefined,
      ownerNearbyRadiusM: config.ownerNearbyRadiusM,
      agentType: config.agentType,
    });
    tickActivityGlobalBlurb(client, store, config, onUsageReportFailure);
    tickTrainingSpellcastEmote(client, store, config);
    const pending = drainPendingReply(store);
    if (pending) {
      clawLog("runner: drain pending DM", pending.targetSessionId, pending.text.slice(0, 40));
      const voiceId = config.voiceId ?? undefined;
      client.sendChat?.(pending.text, { targetSessionId: pending.targetSessionId, voiceId });
      if (voiceId) {
        reportVoiceUsageToHub(config, store, pending.text.length, onUsageReportFailure);
      }
      // Must match chat tool path: otherwise we stay in can_reply and RunConverseAgent can send again (double talk).
      store.setLastAgentChatMessage(pending.text);
      store.setLastTickSentChat(true);
      onWeSentDm(store, pending.targetSessionId);
    }
  };

  /** Tree action: move toward nearest occupant (no LLM). Used when autonomous goal is wander. */
  const tryMoveToNearestOccupant = (): void => {
    if (!client) return;
    const state = store.getState();
    if (state.movementTarget || state.followTargetSessionId || state.nextAutonomousMoveAt > Date.now() || state.pendingGoTalkToAgent)
      return;
    const target = pickWanderMoveTargetOccupant(state.occupants, state.mySessionId, state.myPosition);
    if (!target) return;
    startMoveToOccupant(store, client, target, DEFAULT_STOP_DISTANCE_M);
    clawLog("tree: TryMoveToNearestOccupant", target.type, target.username ?? target.clientId);
  };

  /** Tree action: pick social target (random within priority tier, avoid repeating last when possible), set approach goal, engine follow. */
  const seekSocialTarget = (): void => {
    if (!client) return;
    const state = store.getState();
    const target = pickSocialSeekTargetOccupant(
      state.occupants,
      state.mySessionId,
      state.myPosition,
      state.lastSocialSeekTargetSessionId
    );
    if (!target) return;
    const now = Date.now();
    store.setLastSocialSeekTargetSessionId(target.clientId);
    store.setAutonomousGoal("approach");
    store.setAutonomousTargetSessionId(target.clientId);
    store.setMovementIntent(null);
    store.setMovementTarget(null);
    store.setLastMoveToFailed(null);
    store.setAutonomousEmoteStandStillUntil(0);
    store.setNextAutonomousMoveAt(now + randomCooldownMs());
    const seekCooldownMs =
      config.agentType === "companion" && state.hubCoarseActivity === "conversation"
        ? SOCIAL_SEEK_CONVERSATION_COOLDOWN_MS
        : SOCIAL_SEEK_COOLDOWN_MS;
    store.setSocialSeekCooldownUntil(now + seekCooldownMs);
    store.setFollowTargetSessionId(target.clientId);
    client.approach(target.clientId, { stopDistanceM: CONVERSATION_RANGE_M });
    clawLog("tree: SeekSocialTarget (engine follow)", target.username ?? target.clientId);
  };

  const onInsufficientCreditsBlocked =
    client != null
      ? () => {
          if (!config.hosted || config.skipCreditReport) return;
          const s = store.getState();
          const targetSessionId = s.conversationPeerSessionId ?? s.lastDmPeerSessionId;
          if (!targetSessionId) return;
          const voiceId = config.voiceId ?? undefined;
          clawLog("runner: insufficient credits — replying to", targetSessionId);
          client.sendChat?.(INSUFFICIENT_CREDITS_REPLY_MESSAGE, { targetSessionId, voiceId });
          onWeSentDm(store, targetSessionId);
          if (voiceId) {
            reportVoiceUsageToHub(
              config,
              store,
              INSUFFICIENT_CREDITS_REPLY_MESSAGE.length,
              onUsageReportFailure
            );
          }
          store.setLastAgentChatMessage(INSUFFICIENT_CREDITS_REPLY_MESSAGE);
          store.setLastTickSentChat(true);
        }
      : undefined;

  const loop = createAgentLoop({
    store,
    config,
    runObedientAgent,
    runConverseAgent,
    executeMovementAndDrain: executeMovementAndDrain ?? defaultExecuteMovementAndDrain,
    tryMoveToNearestOccupant,
    seekSocialTarget,
    onInsufficientCreditsBlocked,
  });

  if (client == null) {
    return loop;
  }

  let occupantsInterval: ReturnType<typeof setInterval> | null = null;
  let creditBalanceInterval: ReturnType<typeof setInterval> | null = null;
  let creditBalanceRefreshInFlight = false;

  const refreshOccupants = (): void => {
    void client.getOccupants().then(
      (occupants) => {
        const mySessionId = store.getState().mySessionId;
        store.setOccupants(occupants, mySessionId);
      },
      async (err) => {
        const msg = err instanceof Error ? err.message : String(err);
        if (refreshHubSession && isSessionOrJwtHttpError(msg)) {
          try {
            await refreshHubSession();
            const occupants = await client.getOccupants();
            const mySessionId = store.getState().mySessionId;
            store.setOccupants(occupants, mySessionId);
            clawLog("runner: occupants refresh recovered after hub re-join");
            return;
          } catch (recoveryErr) {
            clawLog(
              "runner: occupants refresh failed",
              msg,
              "— recovery failed:",
              recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr)
            );
            return;
          }
        }
        clawLog("runner: occupants refresh failed", msg);
      }
    );
  };

  const refreshAgentStateFromHub = (): void => {
    if (!config.hosted || config.skipCreditReport || creditBalanceRefreshInFlight) return;
    creditBalanceRefreshInFlight = true;
    void refreshBalance(store, config)
      .then((res) => {
        if (res.ok) {
          const s = store.getState();
          const activityEnd =
            s.hubActivityEndAtMs > 0 ? new Date(s.hubActivityEndAtMs).toISOString() : "—";
          clawLog(
            "runner: hub agent state refreshed",
            "credits=" + res.balance.toFixed(2),
            "agentType=" + config.agentType,
            "activity=" + s.hubCoarseActivity,
            "activityEnd=" + activityEnd
          );
        } else {
          clawLog("runner: hub agent state refresh failed", res.error);
        }
      })
      .finally(() => {
        creditBalanceRefreshInFlight = false;
      });
  };

  return {
    start() {
      if (occupantsInterval != null) return;
      refreshOccupants();
      occupantsInterval = setInterval(refreshOccupants, OCCUPANTS_REFRESH_MS);
      refreshAgentStateFromHub();
      creditBalanceInterval = setInterval(refreshAgentStateFromHub, AGENT_STATE_REFRESH_MS);
      loop.start();
    },
    stop() {
      loop.stop();
      if (occupantsInterval != null) {
        clearInterval(occupantsInterval);
        occupantsInterval = null;
      }
      if (creditBalanceInterval != null) {
        clearInterval(creditBalanceInterval);
        creditBalanceInterval = null;
      }
    },
    step: loop.step.bind(loop),
    getTreeState: loop.getTreeState.bind(loop),
  };
}
