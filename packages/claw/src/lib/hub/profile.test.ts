import { describe, expect, it } from "vitest";
import { createClawStore } from "../state/index.js";
import { testConfig } from "../../util/testHelpers.js";
import { applyHubAgentState, applyHubProfileToConfig } from "./profile.js";
import type { HubAgentProfile } from "./hub.js";

function baseState(
  overrides: Partial<{
    credits: number;
    currentActivity: string;
    activityEndDate: string | null;
    defaultBlockId: string | null;
  }> = {}
) {
  const { credits = 10, currentActivity = "explore", activityEndDate = null, defaultBlockId = null } = overrides;
  return {
    ok: true as const,
    credits,
    agentType: "companion" as const,
    currentActivity,
    activityEndDate,
    defaultBlockId,
  };
}

describe("applyHubAgentState", () => {
  it("resets movement cooldowns and requests autonomous wake when companion activity changes", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ agentType: "companion", ownerUserId: "owner-1" });

    store.setState({
      hubCoarseActivity: "explore",
      wakePending: false,
      lastTriggerUserId: null,
      nextAutonomousMoveAt: Date.now() + 60_000,
      socialSeekCooldownUntil: Date.now() + 60_000,
      movementTarget: { x: 1, z: 2 },
      followTargetSessionId: "peer-1",
      autonomousGoal: "approach",
      autonomousTargetSessionId: "peer-1",
    });

    applyHubAgentState(store, config, baseState({ currentActivity: "conversation" }));

    const s = store.getState();
    expect(s.hubCoarseActivity).toBe("conversation");
    expect(s.nextAutonomousMoveAt).toBe(0);
    expect(s.socialSeekCooldownUntil).toBe(0);
    expect(s.wakePending).toBe(true);
    expect(s.lastTriggerUserId).toBeNull();
    expect(s.movementTarget).toBeNull();
    expect(s.followTargetSessionId).toBeNull();
    expect(s.autonomousGoal).toBe("wander");
    expect(s.autonomousTargetSessionId).toBeNull();
  });

  it("does not override a pending owner wake when activity changes", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ agentType: "companion", ownerUserId: "owner-1" });

    store.setState({
      hubCoarseActivity: "explore",
      wakePending: true,
      lastTriggerUserId: "owner-1",
      nextAutonomousMoveAt: Date.now() + 60_000,
    });

    applyHubAgentState(store, config, baseState({ currentActivity: "conversation" }));

    const s = store.getState();
    expect(s.wakePending).toBe(true);
    expect(s.lastTriggerUserId).toBe("owner-1");
    expect(s.nextAutonomousMoveAt).toBe(0);
  });

  it("skips companion transition for builder agents", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ agentType: "builder" });

    store.setState({
      hubCoarseActivity: "explore",
      wakePending: false,
      nextAutonomousMoveAt: Date.now() + 60_000,
      movementTarget: { x: 1, z: 2 },
    });

    applyHubAgentState(store, config, { ...baseState({ currentActivity: "conversation" }), agentType: "builder" });

    const s = store.getState();
    expect(s.hubCoarseActivity).toBe("conversation");
    expect(s.nextAutonomousMoveAt).toBeGreaterThan(Date.now());
    expect(s.movementTarget).toEqual({ x: 1, z: 2 });
    expect(s.wakePending).toBe(false);
  });

  it("sets config.blockId from state.defaultBlockId when hub sends a non-empty UUID", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ blockId: "env-stale-block-id" });
    applyHubAgentState(store, config, baseState({ defaultBlockId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" }));
    expect(config.blockId).toBe("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee");
  });

  it("does not clear config.blockId when state.defaultBlockId is null", () => {
    const store = createClawStore("0_0");
    const config = testConfig({ blockId: "keep-me" });
    applyHubAgentState(store, config, baseState({ defaultBlockId: null }));
    expect(config.blockId).toBe("keep-me");
  });
});

describe("applyHubProfileToConfig block precedence", () => {
  it("overwrites BLOCK_ID-derived config.blockId when profile has defaultBlockId", () => {
    const config = testConfig({ blockId: "env-block" });
    const profile: HubAgentProfile = { defaultBlockId: "db-block-uuid" };
    applyHubProfileToConfig(config, profile);
    expect(config.blockId).toBe("db-block-uuid");
  });

  it("prefers default_space_id over defaultBlock.blockId when both are set", () => {
    const config = testConfig({ blockId: "env-block" });
    const profile: HubAgentProfile = {
      default_space_id: "space-wins",
      defaultBlock: { blockId: "nested-loses", serverUrl: null },
    };
    applyHubProfileToConfig(config, profile);
    expect(config.blockId).toBe("space-wins");
  });
});
