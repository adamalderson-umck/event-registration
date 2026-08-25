import { describe, expect, it } from "vitest";
import {
  isTrustedAutomationRequest,
  registrationDeliveryKey,
  reminderDeliveryKey,
} from "./email-automation.ts";

describe("trusted email automation", () => {
  it("accepts only the exact dedicated automation secret", () => {
    const trusted = new Request("https://example.test", {
      headers: { "x-email-automation-secret": "automation-secret" },
    });
    const bearerOnly = new Request("https://example.test", {
      headers: { authorization: "Bearer automation-secret" },
    });
    const mismatched = new Request("https://example.test", {
      headers: { "x-email-automation-secret": "wrong-secret" },
    });

    expect(isTrustedAutomationRequest(trusted, "automation-secret")).toBe(true);
    expect(isTrustedAutomationRequest(bearerOnly, "automation-secret")).toBe(false);
    expect(isTrustedAutomationRequest(mismatched, "automation-secret")).toBe(false);
    expect(isTrustedAutomationRequest(trusted, "")).toBe(false);
  });

  it("builds stable registration and occurrence-specific reminder keys", () => {
    expect(
      registrationDeliveryKey(
        "registration_confirmation",
        "reg-1",
        "created-at",
      ),
    )
      .toBe("registration_confirmation:reg-1:created-at");
    expect(reminderDeliveryKey("event-1", "reg-1", "2026-08-15T09:00:00Z", 24))
      .toBe("event_reminder:event-1:reg-1:2026-08-15T09:00:00Z:24");
  });
});
