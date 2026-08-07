import type { SupabaseClient } from "@supabase/supabase-js";

export type DeliveryKind =
  | "registration_confirmation"
  | "registration_waitlist"
  | "registration_cancellation"
  | "waitlist_promotion"
  | "organizer_notification"
  | "event_reminder";

export interface DeliveryClaim {
  deliveryKey: string;
  orgId: string;
  eventId: string;
  registrationId: string;
  kind: DeliveryKind;
}

export type DeliveryClaimResult = "claimed" | "already_sent" | "in_progress";
export type DeliveryResult = "sent" | "already_sent" | "in_progress" | "failed";
export type DeliveryFailureCode =
  | "smtp_send_failed"
  | "smtp_not_configured"
  | "cancel_token_not_configured"
  | "base_url_not_configured"
  | "message_configuration_missing"
  | "recipient_missing"
  | "canonical_record_missing";

export class SanitizedDeliveryError extends Error {
  readonly code: DeliveryFailureCode;

  constructor(code: DeliveryFailureCode) {
    super(code);
    this.name = "SanitizedDeliveryError";
    this.code = code;
  }
}

export interface DeliveryStore {
  claim(delivery: DeliveryClaim): Promise<DeliveryClaimResult>;
  complete(deliveryKey: string): Promise<void>;
  fail(deliveryKey: string, errorCode: string): Promise<void>;
}

export async function deliverOnce(
  store: DeliveryStore,
  delivery: DeliveryClaim,
  send: () => Promise<void>,
): Promise<DeliveryResult> {
  const claimResult = await store.claim(delivery);
  if (claimResult !== "claimed") return claimResult;

  try {
    await send();
    await store.complete(delivery.deliveryKey);
    return "sent";
  } catch (error) {
    const errorCode = error instanceof SanitizedDeliveryError
      ? error.code
      : "smtp_send_failed";
    await store.fail(delivery.deliveryKey, errorCode);
    return "failed";
  }
}

interface DeliveryRow {
  state: "pending" | "sent" | "failed";
  attempt_count: number;
  attempted_at: string;
}

const DEFAULT_PENDING_LEASE_MS = 15 * 60 * 1000;

export function createSupabaseDeliveryStore(
  client: SupabaseClient,
  options: { now?: () => Date; pendingLeaseMs?: number } = {},
): DeliveryStore {
  const now = options.now || (() => new Date());
  const pendingLeaseMs = options.pendingLeaseMs ?? DEFAULT_PENDING_LEASE_MS;

  return {
    async claim(delivery) {
      const attemptedAt = now().toISOString();
      const { error: insertError } = await client.from("email_deliveries")
        .insert({
          delivery_key: delivery.deliveryKey,
          org_id: delivery.orgId,
          event_id: delivery.eventId,
          registration_id: delivery.registrationId,
          kind: delivery.kind,
          state: "pending",
          attempt_count: 1,
          attempted_at: attemptedAt,
          updated_at: attemptedAt,
        });

      if (!insertError) return "claimed";
      if (insertError.code !== "23505") {
        throw new Error("delivery_claim_failed");
      }

      const { data, error: readError } = await client
        .from("email_deliveries")
        .select("state, attempt_count, attempted_at")
        .eq("delivery_key", delivery.deliveryKey)
        .maybeSingle();
      if (readError || !data) throw new Error("delivery_claim_read_failed");

      const existing = data as DeliveryRow;
      if (existing.state === "sent") return "already_sent";

      const attemptedTime = Date.parse(existing.attempted_at);
      const pendingIsFresh = existing.state === "pending" &&
        Number.isFinite(attemptedTime) &&
        now().getTime() - attemptedTime < pendingLeaseMs;
      if (pendingIsFresh) return "in_progress";

      let update = client
        .from("email_deliveries")
        .update({
          state: "pending",
          attempt_count: existing.attempt_count + 1,
          last_error_code: null,
          attempted_at: attemptedAt,
          updated_at: attemptedAt,
        })
        .eq("delivery_key", delivery.deliveryKey)
        .eq("state", existing.state);

      if (existing.state === "pending") {
        update = update.eq("attempted_at", existing.attempted_at);
      }

      const { data: updated, error: updateError } = await update
        .select("delivery_key")
        .maybeSingle();
      if (updateError) throw new Error("delivery_reclaim_failed");
      return updated ? "claimed" : "in_progress";
    },

    async complete(deliveryKey) {
      const completedAt = now().toISOString();
      const { error } = await client.from("email_deliveries").update({
        state: "sent",
        sent_at: completedAt,
        last_error_code: null,
        updated_at: completedAt,
      }).eq("delivery_key", deliveryKey).eq("state", "pending");
      if (error) throw new Error("delivery_complete_failed");
    },

    async fail(deliveryKey, errorCode) {
      const { error } = await client.from("email_deliveries").update({
        state: "failed",
        last_error_code: errorCode,
        updated_at: now().toISOString(),
      }).eq("delivery_key", deliveryKey).eq("state", "pending");
      if (error) throw new Error("delivery_failure_record_failed");
    },
  };
}
