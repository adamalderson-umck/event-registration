export const AUTOMATION_SECRET_HEADER = "x-email-automation-secret";

export function isTrustedAutomationRequest(
  request: Request,
  automationSecret: string,
): boolean {
  return automationSecret.length > 0 &&
    request.headers.get(AUTOMATION_SECRET_HEADER) === automationSecret;
}

export function registrationDeliveryKey(
  kind: string,
  registrationId: string,
  occurrence: string,
): string {
  return `${kind}:${registrationId}:${occurrence}`;
}

export function reminderDeliveryKey(
  eventId: string,
  registrationId: string,
  startDate: string,
  reminderHoursBefore: number,
): string {
  return `event_reminder:${eventId}:${registrationId}:${startDate}:${reminderHoursBefore}`;
}
