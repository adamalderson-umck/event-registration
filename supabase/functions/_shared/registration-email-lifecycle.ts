import { registrationDeliveryKey } from "./email-automation.ts";
import type { DeliveryKind } from "./email-delivery.ts";

export const REGISTRATION_LIFECYCLE_KINDS = [
  "registration_confirmation",
  "registration_waitlist",
  "waitlist_promotion",
  "registration_cancellation",
] as const satisfies readonly DeliveryKind[];

export type RegistrationLifecycleKind =
  typeof REGISTRATION_LIFECYCLE_KINDS[number];

export interface LifecycleRegistration {
  id: string;
  status: string;
  created_at: string;
  promoted_at: string | null;
  cancelled_at: string | null;
}

export interface LifecycleDeliveryRow {
  registration_id: string;
  kind: string;
  delivery_key: string;
}

export function isRegistrationLifecycleKind(
  value: string,
): value is RegistrationLifecycleKind {
  return REGISTRATION_LIFECYCLE_KINDS.includes(
    value as RegistrationLifecycleKind,
  );
}

export function applicableRegistrationLifecycleDelivery(
  registration: LifecycleRegistration,
): {
  kind: RegistrationLifecycleKind;
  occurrence: string;
  deliveryKey: string;
} | null {
  let kind: RegistrationLifecycleKind;
  let occurrence: string | null;

  if (registration.status === "cancelled") {
    kind = "registration_cancellation";
    occurrence = registration.cancelled_at;
  } else if (registration.status === "waitlisted") {
    kind = "registration_waitlist";
    occurrence = registration.created_at;
  } else if (registration.status === "confirmed" && registration.promoted_at) {
    kind = "waitlist_promotion";
    occurrence = registration.promoted_at;
  } else if (registration.status === "confirmed") {
    kind = "registration_confirmation";
    occurrence = registration.created_at;
  } else {
    return null;
  }

  if (!occurrence) return null;
  return {
    kind,
    occurrence,
    deliveryKey: registrationDeliveryKey(kind, registration.id, occurrence),
  };
}

export function matchesApplicableRegistrationLifecycleDelivery({
  registration,
  delivery,
}: {
  registration: LifecycleRegistration;
  delivery: LifecycleDeliveryRow;
}): boolean {
  const applicable = applicableRegistrationLifecycleDelivery(registration);
  return Boolean(
    applicable &&
      delivery.registration_id === registration.id &&
      delivery.kind === applicable.kind &&
      delivery.delivery_key === applicable.deliveryKey,
  );
}
