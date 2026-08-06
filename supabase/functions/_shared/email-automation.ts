export function isTrustedAutomationRequest(
  request: Request,
  serviceRoleKey: string,
): boolean {
  return serviceRoleKey.length > 0 &&
    request.headers.get("authorization") === `Bearer ${serviceRoleKey}`;
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
