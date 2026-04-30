/**
 * Prompts: system content (soul + base + skills) and user message (context for each tick).
 */
export {
  SYSTEM_PROMPT,
  BUILDER_SYSTEM_PROMPT,
  buildSystemContent,
  type ClawConfigPrompt,
} from "./systemPrompt.js";
export { buildUserMessage } from "./userMessage.js";
