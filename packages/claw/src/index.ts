/**
 * @doppelfun/claw — Wake-driven agent with Mistreevous behaviour tree.
 *
 * Entry points: createRunner (wire tree + LLM), bootstrapAgent + createSession (hub + block join),
 * requestWake / requestCronWake (enqueue work), handleChatMessage (wire chat → store + wake).
 * @see docs/PLAN-AGENT-WAKE-DRIVEN.md
 */

export { createAgentLoop, createTreeAgent, TREE_DEFINITION, type AgentLoop, type TreeAgentContext, type TreeStateSnapshot } from "./lib/tree/index.js";
export {
  requestWake,
  requestCronWake,
  requestAutonomousWakeNow,
  type WakeType,
  type WakePayload,
} from "./lib/wake.js";
export { loadConfig, type ClawConfig, type LlmProviderId, type HubAgentType } from "./lib/config/index.js";
export {
  createClawStore,
  createInitialState,
  isAgentRunningLlm,
  isAgentInError,
  type ClawState,
  type ClawStore,
  type ClawStoreApi,
  type ChatEntry,
  type OwnerMessage,
  type PendingScheduledTask,
  type Position3,
  type BuildTarget,
  type BlockDocument,
  type TreeAction,
  type HubCoarseActivity,
} from "./lib/state/index.js";
export { createRunner, type RunnerOptions } from "./lib/runner/index.js";
export { handleChatMessage, type ChatPayload } from "./lib/chat/chatHandler.js";
export {
  pickAutonomousOpeningGreeting,
  AUTONOMOUS_OPENING_GREETINGS,
  matchesStockOpeningGreeting,
} from "./lib/chat/openingGreetings.js";
export {
  buildSystemContent,
  buildUserMessage,
  SYSTEM_PROMPT,
  BUILDER_SYSTEM_PROMPT,
  type ClawConfigPrompt,
} from "./lib/prompts/index.js";
export { runObedientAgentTick } from "./lib/agent/obedientAgent.js";
export { runAutonomousAgentTick } from "./lib/agent/autonomousAgent.js";
export {
  getAgentProfile,
  reportUsage,
  reportVoiceUsage,
  checkBalance,
  fetchHubAgentState,
  joinBlock,
  applyHubProfileToConfig,
  applyHubAgentState,
  getProfileCanonicalBlockId,
  setCachedBalance,
  type HubAgentProfile,
  type HubAgentStateResult,
  type ReportUsageResult,
  type CheckBalanceResult,
  type JoinBlockResult,
} from "./lib/hub/index.js";
export {
  reportUsageToHub,
  reportVoiceUsageToHub,
  hasEnoughCredits,
  refreshBalance,
  MIN_BALANCE_THRESHOLD,
  INSUFFICIENT_CREDITS_REPLY_MESSAGE,
} from "./lib/credits/index.js";
export {
  bootstrapAgent,
  createSession,
  getDefaultBlockId,
  type BootstrapResult,
  type SessionResult,
} from "./lib/bootstrap.js";
export {
  startCronScheduler,
  type CronTaskDef,
  type CronSchedulerOptions,
} from "./lib/cron/index.js";
export {
  applyStuckStateFallbacks,
  STUCK_STATE_FALLBACK_MS,
  type ApplyStuckFallbacksOptions,
} from "./lib/stuckFallbacks.js";
