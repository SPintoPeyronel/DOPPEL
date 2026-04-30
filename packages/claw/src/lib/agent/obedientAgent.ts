/**
 * Obedient agent: owner or cron wake. Builders: chat, move, build tools. Companions: chat and move only.
 */
import { ToolLoopAgent, stepCountIs, hasToolCall } from "ai";
import type { DoppelClient } from "@doppelfun/sdk";
import type { ClawStore } from "../state/index.js";
import type { ClawConfig, HubAgentType } from "../config/index.js";
import {
  buildClawToolSet,
  resolveTickLanguageModel,
  type RunTickLlmResult,
} from "../llm/toolsAi.js";
import type { ExecuteToolResult } from "../../tools/index.js";
import { NO_CHAT_MODEL_ERROR } from "./shared/constants.js";
import { runAgentTick, type AgentLike } from "./shared/runAgentTick.js";

const OBEDIENT_COMPANION_TOOL_NAMES = [
  "chat",
  "start_conversation",
  "emote",
  "get_occupants",
  "approach_position",
  "approach_person",
  "follow",
  "stop",
] as const;

const OBEDIENT_BUILDER_TOOL_NAMES = [
  ...OBEDIENT_COMPANION_TOOL_NAMES,
  "list_catalog",
  "place_catalog_model",
  "list_documents",
  "get_document_content",
  "list_recipes",
  "run_recipe",
  "build_full",
  // "build_incremental", // disabled: always add new document so user can delete/edit latest only
  "build_with_code",
  "delete_document",
  "delete_all_documents",
] as const;

const OBEDIENT_BUILDER_INSTRUCTIONS = `
[OBEDIENT MODE] Do exactly one of:
1) Conversation: If the user asks you to talk to, message, or start a conversation with another person (e.g. "go talk to Alice", "say hi to Bob", "have a conversation with that agent"), call get_occupants, find that person's clientId by username, then use start_conversation with that clientId (and optional openingMessage). Do not reply to the user — go talk to the person they named. When the user asked you to have a conversation with someone, have an organic back-and-forth: reply when they message you and continue naturally until the conversation feels complete (multiple exchanges are fine). Otherwise reply once with the chat tool (targetSessionId = owner / last DM peer). Then stop.
2) Move: use get_occupants if needed, then approach_position, approach_person, or follow (to follow someone); reply with chat saying where you're moving. Then stop.
3) Build: use list_recipes to see options. Use run_recipe with kind city/pyramid/grass/trees and optional params. For custom scenes use build_full or build_with_code for complex scenes with an instruction (always creates a new document). To place a catalog model at coordinates use place_catalog_model with catalogId (from list_catalog), x, y, z; optionally documentId to append to an existing document. Use list_catalog, list_documents, get_document_content, delete_document, delete_all_documents as needed. Then stop.
After run_recipe, build_full, build_with_code, place_catalog_model, delete_document, delete_all_documents, or move/follow/stop tools, you must call chat (same tick if needed) with a short summary of what you did so the owner sees it — unless you only used start_conversation as in (1).
Only the owner can ask you to move or build. If someone else asks, reply "Sorry, I only perform tasks for my owner." Do one action then stop.`;

const OBEDIENT_COMPANION_INSTRUCTIONS = `
[OBEDIENT MODE — COMPANION] Do exactly one of:
1) Conversation: If the user asks you to talk to, message, or start a conversation with another person (e.g. "go talk to Alice", "say hi to Bob", "have a conversation with that agent"), call get_occupants, find that person's clientId by username, then use start_conversation with that clientId (and optional openingMessage). Do not reply to the user — go talk to the person they named. When the user asked you to have a conversation with someone, have an organic back-and-forth: reply when they message you and continue naturally until the conversation feels complete (multiple exchanges are fine). Otherwise reply once with the chat tool (targetSessionId = owner / last DM peer). Then stop.
2) Move: use get_occupants if needed, then approach_position, approach_person, or follow (to follow someone); reply with chat saying where you're moving. Then stop.
You do not build or edit the block. Do not steer chat toward construction, recipes, catalog models, or documents — stay social and in character from your Personality.
After move, follow, or stop, you must call chat (same tick if needed) with a short line so the owner sees it — unless you only used start_conversation as in (1).
Only the owner can ask you to move. If someone else asks you to move or change the world, reply "Sorry, I only follow requests from my owner." Do one action then stop.`;

function obedientToolNames(agentType: HubAgentType): readonly string[] {
  return agentType === "companion" ? OBEDIENT_COMPANION_TOOL_NAMES : OBEDIENT_BUILDER_TOOL_NAMES;
}

function obedientInstructions(agentType: HubAgentType): string {
  return agentType === "companion" ? OBEDIENT_COMPANION_INSTRUCTIONS : OBEDIENT_BUILDER_INSTRUCTIONS;
}

/**
 * Create the Obedient agent (ToolLoopAgent): chat, move, build/recipe tools.
 * Used when HasOwnerWake (owner DM, cron task, or DM to reply).
 *
 * @param client - Engine client for sendChat, sendThinking, etc.
 * @param store - Claw store
 * @param config - Claw config (owner, model, etc.)
 * @param systemContent - Base system prompt (buildSystemContent with the same agentType)
 * @param onToolResult - Optional callback when a tool finishes
 * @returns AgentLike (generate + tools) for runAgentTick
 */
export function createObedientAgent(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void
): AgentLike {
  const model = resolveTickLanguageModel(config);
  if (!model) throw new Error(NO_CHAT_MODEL_ERROR);

  const tools = buildClawToolSet(client, store, config, {
    allowOnlyTools: [...obedientToolNames(config.agentType)],
    onToolResult,
  });

  return new ToolLoopAgent({
    model,
    instructions: systemContent + obedientInstructions(config.agentType),
    tools,
    // Terminal: chat or start_conversation. Other tools may run first; step cap bounds cost (explore → act → chat).
    stopWhen: [stepCountIs(5), hasToolCall("chat"), hasToolCall("start_conversation")],
    maxOutputTokens: 1024,
    temperature: 0.3,
  }) as unknown as AgentLike;
}

/**
 * Run one Obedient agent tick: build agent, generate with userContent, return usage and reply.
 *
 * @param client - Engine client
 * @param store - Claw store
 * @param config - Claw config
 * @param systemContent - Full system prompt (base + OBEDIENT_INSTRUCTIONS)
 * @param userContent - Current user message (from buildUserMessage)
 * @param onToolResult - Optional tool result callback
 * @returns RunTickLlmResult (ok, usage, hadToolCalls, replyText)
 */
export async function runObedientAgentTick(
  client: DoppelClient,
  store: ClawStore,
  config: ClawConfig,
  systemContent: string,
  userContent: string,
  onToolResult?: (name: string, args: string, result: ExecuteToolResult) => void
): Promise<RunTickLlmResult> {
  return runAgentTick(
    client,
    store,
    config,
    systemContent,
    userContent,
    createObedientAgent,
    "obedient",
    onToolResult
  );
}
