import { expect, it, vi } from "vitest";
import { handleRegistrationEmail } from "./handler.ts";

it("rejects retired RETRY requests before any database or mail operation", async () => {
  const dependencies = {
    automationSecret: "test-automation-secret",
    baseUrl: "https://events.example.org",
    loadDelivery: vi.fn(async () => ({ status: "missing" as const })),
    loadCanonicalDelivery: vi.fn(async () => ({ status: "missing" as const })),
    generateCancelToken: vi.fn(async () => "unused-token"),
    loadSmtpPassword: vi.fn(async () => "unused-password"),
    deliver: vi.fn(async () => "sent" as const),
    send: vi.fn(async () => {}),
  };
  const response = await handleRegistrationEmail(
    new Request("https://example.test", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-email-automation-secret": dependencies.automationSecret,
      },
      body: JSON.stringify({ type: "RETRY", delivery_id: "delivery-1" }),
    }),
    dependencies,
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "invalid_request" });
  for (
    const operation of [
      dependencies.loadDelivery,
      dependencies.loadCanonicalDelivery,
      dependencies.generateCancelToken,
      dependencies.loadSmtpPassword,
      dependencies.deliver,
      dependencies.send,
    ]
  ) {
    expect(operation).not.toHaveBeenCalled();
  }
});
