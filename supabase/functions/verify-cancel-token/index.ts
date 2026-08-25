import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { createVerifyCancelTokenHandler } from "./handler.ts";

/**
 * verify-cancel-token
 *
 * Verifies an HMAC-SHA256 cancel token and performs the cancellation.
 * Token format (base64): orgId:registrationId:hmacSignature
 *
 * The HMAC is computed over "orgId:registrationId" using the
 * CANCEL_TOKEN_SECRET environment variable.
 */

Deno.serve(createVerifyCancelTokenHandler({
  getEnvironment: (name) => Deno.env.get(name),
  createAdminClient: (url, serviceRoleKey) => createClient(url, serviceRoleKey),
  logError: (...values) => console.error(...values),
}));
