import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

/**
 * verify-cancel-token
 *
 * Verifies an HMAC-SHA256 cancel token and performs the cancellation.
 * Token format (base64): orgId:registrationId:hmacSignature
 *
 * The HMAC is computed over "orgId:registrationId" using the
 * CANCEL_TOKEN_SECRET environment variable.
 */

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
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  // Constant-time comparison
  if (computed.length !== signature.length) return false;
  let result = 0;
  for (let i = 0; i < computed.length; i++) {
    result |= computed.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return result === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  try {
    const { token, dry_run } = await req.json().catch(() => ({ token: null, dry_run: false }));

    if (!token || typeof token !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing or invalid token" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const secret = Deno.env.get("CANCEL_TOKEN_SECRET");
    if (!secret) {
      console.error("CANCEL_TOKEN_SECRET is not set");
      return new Response(
        JSON.stringify({ error: "Server misconfigured" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    // Decode base64 token
    let decoded: string;
    try {
      decoded = atob(token);
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid token format" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const parts = decoded.split(":");
    if (parts.length !== 3) {
      return new Response(
        JSON.stringify({ error: "Invalid token structure" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const [orgId, registrationId, signature] = parts;
    const message = `${orgId}:${registrationId}`;

    const isValid = await hmacVerify(secret, message, signature);
    if (!isValid) {
      return new Response(
        JSON.stringify({ error: "Invalid or expired cancellation link" }),
        { status: 403, headers: { "Content-Type": "application/json" } },
      );
    }

    // Token is valid => initialize service role proxy client
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    if (dry_run) {
      // PROXY RLS: Query registration securely so frontend users do not need read access table-wide
      const { data: regData, error: regErr } = await supabase
        .from("registrations")
        .select("status, event_id")
        .eq("id", registrationId)
        .eq("org_id", orgId)
        .single();

      if (regErr || !regData) {
        return new Response(
          JSON.stringify({ error: "Registration not found" }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        );
      }

      // Query event title securely
      let eventTitle = "Event";
      if (regData.event_id) {
        const { data: eventData } = await supabase
          .from("events")
          .select("title")
          .eq("id", regData.event_id)
          .single();
        if (eventData) eventTitle = eventData.title;
      }

      return new Response(
        JSON.stringify({ 
          success: true, 
          status: regData.status,
          eventTitle: eventTitle
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }

    // Perform cancellation
    const { error: rpcErr } = await supabase.rpc("cancel_registration", {
      p_registration_id: registrationId,
      p_org_id: orgId,
    });

    if (rpcErr) {
      console.error("cancel_registration RPC error:", rpcErr);
      return new Response(
        JSON.stringify({ error: "Failed to cancel registration" }),
        { status: 500, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(
      JSON.stringify({ success: true, orgId, registrationId }),
      { headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("verify-cancel-token error:", err);
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
