const ALLOWED_ORIGINS = new Set([
  "https://events.kentmethodist.org",
  "https://event-registration-b7840.web.app",
  "http://localhost:5173",
  "http://127.0.0.1:5173",
]);

interface QueryResult {
  data: Record<string, unknown> | null;
  error: unknown;
}

interface QueryBuilder {
  select(columns: string): QueryBuilder;
  eq(column: string, value: string): QueryBuilder;
  single(): Promise<QueryResult>;
}

interface AdminClient {
  from(table: string): QueryBuilder;
  rpc(
    name: string,
    parameters: Record<string, string>,
  ): Promise<{ error: unknown }>;
}

export interface VerifyCancelTokenDependencies {
  getEnvironment(name: string): string | undefined;
  createAdminClient(url: string, serviceRoleKey: string): unknown;
  logError(...values: unknown[]): void;
}

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  });
  const origin = request.headers.get("Origin");
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
  }
  return headers;
}

function jsonResponse(
  body: Record<string, unknown>,
  headers: Headers,
  status = 200,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

async function hmacVerify(
  secret: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(message));
  const computed = Array.from(new Uint8Array(sig))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  if (computed.length !== signature.length) return false;
  let result = 0;
  for (let index = 0; index < computed.length; index++) {
    result |= computed.charCodeAt(index) ^ signature.charCodeAt(index);
  }
  return result === 0;
}

export function createVerifyCancelTokenHandler(
  dependencies: VerifyCancelTokenDependencies,
) {
  return async (request: Request): Promise<Response> => {
    const responseHeaders = corsHeaders(request);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: responseHeaders });
    }

    if (request.method !== "POST") {
      return new Response("Method not allowed", {
        status: 405,
        headers: responseHeaders,
      });
    }

    try {
      const { token, dry_run } = await request.json().catch(() => ({
        token: null,
        dry_run: false,
      }));

      if (!token || typeof token !== "string") {
        return jsonResponse(
          { error: "Missing or invalid token" },
          responseHeaders,
          400,
        );
      }

      const secret = dependencies.getEnvironment("CANCEL_TOKEN_SECRET");
      if (!secret) {
        dependencies.logError("CANCEL_TOKEN_SECRET is not set");
        return jsonResponse(
          { error: "Server misconfigured" },
          responseHeaders,
          500,
        );
      }

      let decoded: string;
      try {
        decoded = atob(token);
      } catch {
        return jsonResponse(
          { error: "Invalid token format" },
          responseHeaders,
          400,
        );
      }

      const parts = decoded.split(":");
      if (parts.length !== 3) {
        return jsonResponse(
          { error: "Invalid token structure" },
          responseHeaders,
          400,
        );
      }

      const [orgId, registrationId, signature] = parts;
      const message = `${orgId}:${registrationId}`;
      const isValid = await hmacVerify(secret, message, signature);
      if (!isValid) {
        return jsonResponse(
          { error: "Invalid or expired cancellation link" },
          responseHeaders,
          403,
        );
      }

      const client = dependencies.createAdminClient(
        dependencies.getEnvironment("SUPABASE_URL")!,
        dependencies.getEnvironment("SUPABASE_SERVICE_ROLE_KEY")!,
      ) as AdminClient;

      if (dry_run) {
        const { data: registration, error: registrationError } = await client
          .from("registrations")
          .select("status, event_id")
          .eq("id", registrationId)
          .eq("org_id", orgId)
          .single();

        if (registrationError || !registration) {
          return jsonResponse(
            { error: "Registration not found" },
            responseHeaders,
            404,
          );
        }

        let eventTitle = "Event";
        const eventId = registration.event_id;
        if (typeof eventId === "string" && eventId) {
          const { data: event } = await client
            .from("events")
            .select("title")
            .eq("id", eventId)
            .single();
          if (event && typeof event.title === "string") {
            eventTitle = event.title;
          }
        }

        return jsonResponse(
          {
            success: true,
            status: registration.status,
            eventTitle,
          },
          responseHeaders,
        );
      }

      const { error: rpcError } = await client.rpc("cancel_registration", {
        p_registration_id: registrationId,
        p_org_id: orgId,
      });

      if (rpcError) {
        dependencies.logError("cancel_registration RPC error:", rpcError);
        return jsonResponse(
          { error: "Failed to cancel registration" },
          responseHeaders,
          500,
        );
      }

      return jsonResponse(
        { success: true, orgId, registrationId },
        responseHeaders,
      );
    } catch (error) {
      dependencies.logError("verify-cancel-token error:", error);
      return jsonResponse(
        { error: (error as Error).message },
        responseHeaders,
        500,
      );
    }
  };
}
