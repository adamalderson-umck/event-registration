import { describe, expect, it } from "vitest";
import {
  applicableRegistrationLifecycleDelivery,
  isRegistrationLifecycleKind,
  matchesApplicableRegistrationLifecycleDelivery,
} from "./registration-email-lifecycle.ts";

const registration = (overrides: Record<string, unknown> = {}) => ({
  id: "registration-1",
  status: "confirmed",
  created_at: "2026-08-01T12:00:00+00:00",
  promoted_at: null,
  cancelled_at: null,
  ...overrides,
});

describe("registration email lifecycle", () => {
  it.each([
    [registration(), "registration_confirmation", "2026-08-01T12:00:00+00:00"],
    [registration({ status: "waitlisted" }), "registration_waitlist", "2026-08-01T12:00:00+00:00"],
    [registration({ promoted_at: "2026-08-02T12:00:00+00:00" }), "waitlist_promotion", "2026-08-02T12:00:00+00:00"],
    [registration({ status: "cancelled", cancelled_at: "2026-08-03T12:00:00+00:00" }), "registration_cancellation", "2026-08-03T12:00:00+00:00"],
  ])("maps the canonical state to %s", (record, kind, occurrence) => {
    expect(applicableRegistrationLifecycleDelivery(record)).toEqual({
      kind,
      occurrence,
      deliveryKey: `${kind}:registration-1:${occurrence}`,
    });
  });

  it("returns no applicable delivery for incomplete states", () => {
    expect(applicableRegistrationLifecycleDelivery(
      registration({ status: "cancelled", cancelled_at: null }),
    )).toBeNull();
    expect(applicableRegistrationLifecycleDelivery(
      registration({ status: "pending" }),
    )).toBeNull();
  });

  it("accepts only registrant lifecycle kinds", () => {
    expect(isRegistrationLifecycleKind("registration_confirmation")).toBe(true);
    expect(isRegistrationLifecycleKind("registration_waitlist")).toBe(true);
    expect(isRegistrationLifecycleKind("waitlist_promotion")).toBe(true);
    expect(isRegistrationLifecycleKind("registration_cancellation")).toBe(true);
    expect(isRegistrationLifecycleKind("organizer_notification")).toBe(false);
    expect(isRegistrationLifecycleKind("event_reminder")).toBe(false);
  });

  it("rejects an obsolete key even when the registration and kind match", () => {
    expect(matchesApplicableRegistrationLifecycleDelivery({
      registration: registration({ promoted_at: "2026-08-02T12:00:00+00:00" }),
      delivery: {
        registration_id: "registration-1",
        kind: "waitlist_promotion",
        delivery_key: "waitlist_promotion:registration-1:2026-08-01T12:00:00+00:00",
      },
    })).toBe(false);
  });
});
