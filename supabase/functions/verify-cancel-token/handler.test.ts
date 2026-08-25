import { describe, expect, it, vi } from "vitest";
import { createVerifyCancelTokenHandler } from "./handler.ts";

const allowedOrigin = "https://events.kentmethodist.org";

function handler() {
  return createVerifyCancelTokenHandler({
    getEnvironment: vi.fn(),
    createAdminClient: vi.fn(),
    logError: vi.fn(),
  });
}

describe("verify-cancel-token CORS", () => {
  it("answers an allowed browser preflight with the complete CORS contract", async () => {
    const response = await handler()(
      new Request(
        "https://example.test/verify-cancel-token",
        {
          method: "OPTIONS",
          headers: {
            Origin: allowedOrigin,
            "Access-Control-Request-Method": "POST",
            "Access-Control-Request-Headers":
              "authorization,content-type,x-client-info,apikey",
          },
        },
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      allowedOrigin,
    );
    expect(response.headers.get("Access-Control-Allow-Methods")).toBe(
      "POST, OPTIONS",
    );
    expect(response.headers.get("Access-Control-Allow-Headers")).toBe(
      "authorization, x-client-info, apikey, content-type",
    );
    expect(response.headers.get("Vary")).toBe("Origin");
  });

  it("adds CORS headers to an allowed POST error response", async () => {
    const response = await handler()(
      new Request(
        "https://example.test/verify-cancel-token",
        {
          method: "POST",
          headers: {
            Origin: allowedOrigin,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        },
      ),
    );

    expect(response.status).toBe(400);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe(
      allowedOrigin,
    );
    await expect(response.json()).resolves.toEqual({
      error: "Missing or invalid token",
    });
  });

  it("does not grant CORS access to an unapproved origin", async () => {
    const response = await handler()(
      new Request(
        "https://example.test/verify-cancel-token",
        {
          method: "OPTIONS",
          headers: { Origin: "https://attacker.example" },
        },
      ),
    );

    expect(response.status).toBe(204);
    expect(response.headers.has("Access-Control-Allow-Origin")).toBe(false);
    expect(response.headers.get("Vary")).toBe("Origin");
  });
});
