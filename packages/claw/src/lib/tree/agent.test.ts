import { describe, it, expect } from "vitest";
import { createTreeAgent } from "./agent.js";
import { createAgentLoop } from "./loop.js";
import { createClawStore } from "../state/index.js";
import { testConfig } from "../../util/testHelpers.js";
import type { ClawConfig } from "../config/index.js";

function createTestContext(overrides?: Partial<ClawConfig>) {
  const store = createClawStore("0_0");
  const config = testConfig(overrides);
  return { store, config };
}

describe("createTreeAgent", () => {
  describe("HasOwnerWake", () => {
    it("returns true when wakePending and lastTriggerUserId is owner", () => {
      const { store, config } = createTestContext({ ownerUserId: "owner-1" });
      store.setWakePending(true);
      store.setLastTriggerUserId("owner-1");
      const agent = createTreeAgent({ store, config });
      expect(agent.HasOwnerWake()).toBe(true);
    });

    it("returns false when wakePending but lastTriggerUserId is not owner", () => {
      const { store, config } = createTestContext({ ownerUserId: "owner-1" });
      store.setWakePending(true);
      store.setLastTriggerUserId("other-user");
      const agent = createTreeAgent({ store, config });
      expect(agent.HasOwnerWake()).toBe(false);
    });

    it("returns true when wakePending and pendingScheduledTask is set", () => {
      const { store, config } = createTestContext();
      store.setWakePending(true);
      store.setPendingScheduledTask({ taskId: "t1", instruction: "Do something" });
      const agent = createTreeAgent({ store, config });
      expect(agent.HasOwnerWake()).toBe(true);
    });

    it("returns false when not wakePending", () => {
      const { store, config } = createTestContext({ ownerUserId: "owner-1" });
      store.clearWake();
      store.setLastTriggerUserId("owner-1");
      const agent = createTreeAgent({ store, config });
      expect(agent.HasOwnerWake()).toBe(false);
    });
  });

  describe("NotInConversation", () => {
    it("returns true when conversationPhase is idle", () => {
      const { store, config } = createTestContext();
      store.setConversationPhase("idle");
      const agent = createTreeAgent({ store, config });
      expect(agent.NotInConversation()).toBe(true);
    });

    it("returns false when conversationPhase is can_reply or waiting_for_reply", () => {
      const { store, config } = createTestContext();
      store.setConversationPhase("can_reply");
      const agent = createTreeAgent({ store, config });
      expect(agent.NotInConversation()).toBe(false);
      store.setConversationPhase("waiting_for_reply");
      expect(agent.NotInConversation()).toBe(false);
    });
  });

  describe("HasEnoughCredits", () => {
    it("returns true when not hosted", () => {
      const { store, config } = createTestContext({ hosted: false });
      store.setState({ cachedBalance: 0 });
      const agent = createTreeAgent({ store, config });
      expect(agent.HasEnoughCredits()).toBe(true);
    });

    it("returns false when hosted and balance below threshold", () => {
      const { store, config } = createTestContext({
        hosted: true,
        skipCreditReport: false,
      });
      store.setState({ cachedBalance: 0, dailySpend: 0 });
      const agent = createTreeAgent({ store, config });
      expect(agent.HasEnoughCredits()).toBe(false);
    });
  });

  describe("RequestAutonomousWake", () => {
    it("sets wakePending and lastTriggerUserId=null so next tick runs autonomous branch", async () => {
      const { store, config } = createTestContext({ ownerUserId: "owner-1", agentType: "companion" });
      store.setLastTriggerUserId("owner-1");
      const agent = createTreeAgent({ store, config });
      const { State } = await import("mistreevous");
      expect(agent.RequestAutonomousWake()).toBe(State.SUCCEEDED);
      const s = store.getState();
      expect(s.wakePending).toBe(true);
      expect(s.lastTriggerUserId).toBe(null);
      expect(agent.HasOwnerWake()).toBe(false);
      expect(agent.HasAutonomousWake()).toBe(true);
    });
  });

  describe("ClearWakeIdle", () => {
    it("clears wake and returns SUCCEEDED", async () => {
      const { store, config } = createTestContext();
      store.setWakePending(true);
      const agent = createTreeAgent({ store, config });
      const { State } = await import("mistreevous");
      expect(agent.ClearWakeIdle()).toBe(State.SUCCEEDED);
      expect(store.getState().wakePending).toBe(false);
    });

    it("sets currentAction to idle", () => {
      const { store, config } = createTestContext();
      const agent = createTreeAgent({ store, config });
      agent.ClearWakeIdle();
      expect(store.getState().currentAction).toBe("idle");
    });

    it("sets lastCompletedAction and lastCompletedActionAt on completion", () => {
      const { store, config } = createTestContext();
      const agent = createTreeAgent({ store, config });
      agent.ClearWakeIdle();
      const s = store.getState();
      expect(s.lastCompletedAction).toBe("idle");
      expect(typeof s.lastCompletedActionAt).toBe("number");
      expect(s.lastCompletedActionAt).toBeGreaterThan(0);
    });
  });

  describe("currentAction", () => {
    it("ExecuteMovementAndDrain sets currentAction to movement_only", () => {
      const { store, config } = createTestContext();
      const agent = createTreeAgent({ store, config });
      agent.ExecuteMovementAndDrain();
      expect(store.getState().currentAction).toBe("movement_only");
    });

    it("ClearWakeInsufficientCredits sets currentAction to clearing_wake_insufficient_credits", () => {
      const { store, config } = createTestContext({
        hosted: true,
        ownerUserId: "owner-1",
      });
      store.setWakePending(true);
      store.setLastTriggerUserId("owner-1");
      store.setState({ cachedBalance: 0, dailySpend: 0 });
      const agent = createTreeAgent({ store, config });
      agent.ClearWakeInsufficientCredits();
      expect(store.getState().currentAction).toBe("clearing_wake_insufficient_credits");
    });

    it("ClearWakeInsufficientCredits invokes onInsufficientCreditsBlocked when set", () => {
      let called = false;
      const { store, config } = createTestContext({
        hosted: true,
        ownerUserId: "owner-1",
      });
      store.setWakePending(true);
      store.setLastTriggerUserId("owner-1");
      store.setState({ cachedBalance: 0, dailySpend: 0 });
      const agent = createTreeAgent({
        store,
        config,
        onInsufficientCreditsBlocked: () => {
          called = true;
        },
      });
      agent.ClearWakeInsufficientCredits();
      expect(called).toBe(true);
    });

    it("RequestAutonomousWake sets currentAction to requesting_autonomous_wake", () => {
      const { store, config } = createTestContext({ ownerUserId: "owner-1", agentType: "companion" });
      const agent = createTreeAgent({ store, config });
      agent.RequestAutonomousWake();
      expect(store.getState().currentAction).toBe("requesting_autonomous_wake");
    });

    it("TryMoveToNearestOccupant sets currentAction to autonomous_move", () => {
      const { store, config } = createTestContext();
      const agent = createTreeAgent({ store, config });
      agent.TryMoveToNearestOccupant();
      expect(store.getState().currentAction).toBe("autonomous_move");
    });
  });

  describe("HasAutonomousWake", () => {
    it("is false for builder even when wake is non-owner", () => {
      const { store, config } = createTestContext({ ownerUserId: "owner-1", agentType: "builder" });
      store.setWakePending(true);
      store.setLastTriggerUserId(null);
      const agent = createTreeAgent({ store, config });
      expect(agent.HasAutonomousWake()).toBe(false);
    });

    it("is true for companion when wake is non-owner", () => {
      const { store, config } = createTestContext({ ownerUserId: "owner-1", agentType: "companion" });
      store.setWakePending(true);
      store.setLastTriggerUserId(null);
      const agent = createTreeAgent({ store, config });
      expect(agent.HasAutonomousWake()).toBe(true);
    });
  });

  describe("OwnerAwayOrInConversation", () => {
    it("is false when owner is in-world nearby and no skill run is active", () => {
      const { store, config } = createTestContext({
        ownerUserId: "owner-1",
        agentType: "companion",
      });
      store.setConversationPhase("idle");
      store.setState({
        hubCoarseActivity: "idle",
        hubActivityEndAtMs: 0,
      });
      store.setOccupants(
        [
          { clientId: "me", userId: "agent-a", type: "agent", position: { x: 0, z: 0 } },
          { clientId: "owner-sess", userId: "owner-1", type: "user", position: { x: 1, z: 0 } },
        ],
        "me"
      );
      const agent = createTreeAgent({ store, config });
      expect(agent.OwnerAwayOrInConversation()).toBe(false);
    });

    it("is true when owner is nearby but a companion skill run window is active (observe + rapport)", () => {
      const { store, config } = createTestContext({
        ownerUserId: "owner-1",
        agentType: "companion",
      });
      store.setConversationPhase("idle");
      store.setState({
        hubCoarseActivity: "conversation",
        hubActivityEndAtMs: Date.now() + 3_600_000,
      });
      store.setOccupants(
        [
          { clientId: "me", userId: "agent-a", type: "agent", position: { x: 0, z: 0 } },
          { clientId: "owner-sess", userId: "owner-1", type: "user", position: { x: 1, z: 0 } },
        ],
        "me"
      );
      const agent = createTreeAgent({ store, config });
      expect(agent.OwnerAwayOrInConversation()).toBe(true);
    });

    it("stays true past activityEndDate while hub still reports a pending run (until Return)", () => {
      const { store, config } = createTestContext({
        ownerUserId: "owner-1",
        agentType: "companion",
      });
      store.setConversationPhase("idle");
      store.setState({
        hubCoarseActivity: "conversation",
        hubActivityEndAtMs: Date.now() - 60_000,
      });
      store.setOccupants(
        [
          { clientId: "me", userId: "agent-a", type: "agent", position: { x: 0, z: 0 } },
          { clientId: "owner-sess", userId: "owner-1", type: "user", position: { x: 1, z: 0 } },
        ],
        "me"
      );
      const agent = createTreeAgent({ store, config });
      expect(agent.OwnerAwayOrInConversation()).toBe(true);
    });
  });

  describe("getTreeState", () => {
    it("returns snapshot with state string after step", () => {
      const { store, config } = createTestContext();
      const loop = createAgentLoop({ store, config });
      loop.step();
      const snapshot = loop.getTreeState();
      expect(snapshot).toHaveProperty("state");
      expect(typeof snapshot.state).toBe("string");
      expect(snapshot.state.length).toBeGreaterThan(0);
    });
  });
});
