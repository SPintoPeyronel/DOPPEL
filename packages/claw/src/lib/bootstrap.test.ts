import { describe, it, expect } from "vitest";
import { getDefaultBlockId } from "./bootstrap.js";
import { testConfig } from "../util/testHelpers.js";
import type { HubAgentProfile } from "./hub/index.js";

describe("getDefaultBlockId", () => {
  it("returns profile.defaultBlock.blockId when set", () => {
    const profile: HubAgentProfile = {
      defaultBlock: { blockId: "profile-block", serverUrl: "https://example.com" },
    };
    const config = testConfig({ blockId: "config-block" });
    expect(getDefaultBlockId(profile, config, "0_0")).toBe("profile-block");
  });

  it("returns profile.default_space_id when defaultBlock missing", () => {
    const profile: HubAgentProfile = { default_space_id: " space-42 " };
    const config = testConfig({ blockId: "config-block" });
    expect(getDefaultBlockId(profile, config, "0_0")).toBe("space-42");
  });

  it("returns profile.defaultBlockId over BLOCK_ID env when nested defaultBlock is absent", () => {
    const profile: HubAgentProfile = { defaultBlockId: "top-level-db-uuid" };
    const config = testConfig({ blockId: "env-fallback" });
    expect(getDefaultBlockId(profile, config, "0_0")).toBe("top-level-db-uuid");
  });

  it("prefers default_space_id over defaultBlock.blockId when both present", () => {
    const profile: HubAgentProfile = {
      default_space_id: "from-db-column",
      defaultBlock: { blockId: "from-join-row", serverUrl: null },
    };
    const config = testConfig({ blockId: "env" });
    expect(getDefaultBlockId(profile, config, "0_0")).toBe("from-db-column");
  });

  it("returns config.blockId when profile has no block", () => {
    const config = testConfig({ blockId: "config-block" });
    expect(getDefaultBlockId(undefined, config, "0_0")).toBe("config-block");
  });

  it("returns fallback when no profile or config block", () => {
    const config = testConfig({ blockId: null });
    expect(getDefaultBlockId(undefined, config, "0_0")).toBe("0_0");
  });
});
