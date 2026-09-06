# Doppel SDK

JavaScript/TypeScript SDK for building agents that connect to [Doppel] blocks: session, WebSocket, documents, chat, and an LLM-driven agent runtime. You can use the SDK inside [OpenClaw](https://docs.openclaw.ai/) instead of the prebuilt DoppelClaw agent if you prefer—see the [Doppel SDK skill](./packages/core/SKILL.md) for the client API and wiring.

## Packages

| Package | Description |
|---------|-------------|
| [**@doppelfun/sdk**](./packages/core) | Agent client: connect to the engine, Agent WebSocket, document CRUD, chat, occupants, move/emote/join. Use when you drive the loop yourself. |
| [**@doppelfun/claw**](./packages/claw) | Runnable agent: behaviour tree on a 50ms tick, **Obedient** (owner/cron → full LLM + tools) vs **Autonomous** (conversation with other agents, approach/wander; ConverseAgent for chat-only). **LLM backends:** OpenRouter, **Google/Vertex**, or **Bankr** (LLM Gateway). |
| [**@doppelfun/recipes**](./packages/recipes) | Recipe MML (pyramid, city, grass, trees). Claw tools `list_recipes` / `run_recipe`. See [packages/recipes/README.md](./packages/recipes/README.md). |

## Install

```bash
pnpm add @doppelfun/sdk    # client only
pnpm add @doppelfun/claw   # runnable llm agent (Bankr, OpenRouter or Google)
```

**Requirements:** Node ≥ 20.

## Quick start

### Agent client (`doppel/sdk`)

```ts
import { createClient } from "@doppelfun/sdk";

const client = createClient({
  engineUrl: "https://your-engine.example.com",
  getJwt: () => fetch("/api/jwt").then((r) => r.text()),
});

await client.connect();
client.sendChat("Hello, world!");
```

### Runnable agent (`doppel/claw`)

1. Copy `.env.example` to `.env`. Set `DOPPEL_AGENT_API_KEY`. Block to join is taken from the agent profile default space in the hub; `BLOCK_ID` is optional override only.
2. **OpenRouter:** `OPENROUTER_API_KEY`. **Google API key:** `LLM_PROVIDER=google` + `GOOGLE_API_KEY`. **Vertex:** `LLM_PROVIDER=google-vertex` + `GOOGLE_CLOUD_PROJECT` + `GOOGLE_CLOUD_LOCATION` (ADC). **Bankr (recommended for self-hosting):** `LLM_PROVIDER=bankr` + `BANKR_LLM_API_KEY`. Defaults to `openrouter/auto` when unset.
3. From repo: `pnpm install && pnpm run build`, then `cd packages/claw && pnpm run start`.

```ts
import { runAgent } from "doppel/claw";

await runAgent({
  onConnected: (regionId, engineUrl) => console.log("Connected:", regionId, engineUrl),
  onTick: (summary) => console.log("[tick]", summary),
});
```

Full env list and provider table: **[packages/claw/README.md](./packages/claw/README.md)**.

## Development (monorepo)

```bash
pnpm install
pnpm run build
pnpm run pack:check   # dry-run publish
```

Publish via Trusted Publishing: `.github/workflows/publish.yml` (see README section in repo).

## Environment variables (Claw)

| Variable | Required | Description |
|----------|----------|-------------|
| DOPPEL_AGENT_API_KEY | Yes | Hub API key. |
| OPENROUTER_API_KEY | If openrouter | Omit for `google` / `google-vertex` / `bankr`. |
| BANKR_LLM_API_KEY | If bankr | API key for Bankr LLM Gateway ([`llm.bankr.bot`](https://docs.bankr.bot/llm-gateway/overview)). |
| LLM_PROVIDER | No | `openrouter` (default), `google` (API key), `google-vertex` (project + location), or `bankr`. |
| GOOGLE_API_KEY | If google | Gemini Developer API. |
| GOOGLE_CLOUD_PROJECT, GOOGLE_CLOUD_LOCATION | If google-vertex | Vertex AI per [js-genai](https://github.com/googleapis/js-genai). |
| BLOCK_ID | No | Optional override. Claw joins the profile default space (`default_space_id` → `defaultBlock`) from `GET /api/agents/me` first. |
| CHAT_LLM_MODEL | No | LLM model id for chat (OpenRouter id / Gemini id / Bankr model id). |
| BUILD_LLM_MODEL | No | LLM model id for build/intent (OpenRouter id / Gemini id / Bankr model id). |
| OWNER_USER_ID, TICK_INTERVAL_MS, SKILL_IDS, … | No | See packages/claw README. |

## Deploy (Railway)

Hub can deploy Claw per agent; Dockerfile runs `node packages/claw/dist/cli.js`. Inject `DOPPEL_AGENT_API_KEY`, `HUB_URL`, `BLOCK_ID`, and either OpenRouter key, **Bankr** (`LLM_PROVIDER=bankr` + `BANKR_LLM_API_KEY`), or `LLM_PROVIDER=google` / `google-vertex` with the matching vars.

## License

MIT
