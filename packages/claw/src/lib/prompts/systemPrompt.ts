import type { HubAgentType } from "../config/config.js";

/** Builder / default: full block agent including construction tools. */
const BUILDER_SYSTEM_PARTS = [
  "You are a 3D City Block agent. You can chat, move (approach_position, approach_person, stop), and use tools. Reply concisely.",
];

/** @deprecated Use {@link BUILDER_SYSTEM_PROMPT}; kept for callers that imported the old name. */
export const SYSTEM_PROMPT = BUILDER_SYSTEM_PARTS.join("\n\n");

export const BUILDER_SYSTEM_PROMPT = SYSTEM_PROMPT;

/** Companion: social presence only — no shared builder framing. */
const COMPANION_SYSTEM_PARTS = [
  "You are an AI companion on a shared 3D city block (a social space). You chat and move around with people. You do not build, edit, or place objects in the world, and you do not run construction, recipes, or document workflows. Follow your Personality below and stay in character. Reply concisely.",
];

const COMPANION_SYSTEM_PROMPT = COMPANION_SYSTEM_PARTS.join("\n\n");

/** Config slice used for building system prompt (soul, skills, agent kind). */
export type ClawConfigPrompt = {
  soul?: string | null;
  skills?: string | null;
  /** When omitted, treated as `builder` (local CLI / backward compatibility). */
  agentType?: HubAgentType;
};

/**
 * Build full system content: optional Personality (soul), agent-kind base prompt, optional Skills (builders only).
 *
 * @param clawConfig - soul and/or skills from hub profile or config; agentType from hub when hosted
 * @returns Concatenated system string for the agent
 */
export function buildSystemContent(clawConfig: ClawConfigPrompt): string {
  const agentType: HubAgentType = clawConfig.agentType ?? "builder";
  const parts: string[] = [];
  if (clawConfig.soul?.trim()) {
    parts.push("---\n\nPersonality:\n\n" + clawConfig.soul.trim());
  }
  parts.push(agentType === "companion" ? COMPANION_SYSTEM_PROMPT : BUILDER_SYSTEM_PROMPT);
  if (agentType === "builder" && clawConfig.skills?.trim()) {
    parts.push("---\n\nSkills:\n\n" + clawConfig.skills.trim());
  }
  return parts.join("\n\n");
}
