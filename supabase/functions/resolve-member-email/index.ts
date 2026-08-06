import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import {
  isKentMethodistEmail,
  isKentMethodistGoogleUser,
} from "../_shared/admin-access.ts";

interface RequestBody {
  orgId: string;
  email: string;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "Content-Type": "application/json" },
});

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAdmin = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const supabaseUser = createClient(
      supabaseUrl,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user: callingUser }, error: authError } =
      await supabaseUser.auth.getUser();
    const { data: databaseAuthorized, error: accessError } =
      await supabaseUser.rpc("is_kentmethodist_admin");

    if (
      authError || accessError || !isKentMethodistGoogleUser(callingUser) ||
      databaseAuthorized !== true
    ) {
      return json({ error: "Unauthorized" }, 401);
    }

    const { orgId, email }: RequestBody = await req.json();
    const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";

    if (!orgId || !isKentMethodistEmail(normalizedEmail)) {
      return json({
        error: "A kentmethodist.org Google Workspace email is required",
      }, 400);
    }

    const { data: org, error: orgError } = await supabaseAdmin
      .from("organizations")
      .select("owner_uid")
      .eq("id", orgId)
      .single();

    if (orgError || !org) return json({ error: "Organization not found" }, 404);
    if (org.owner_uid !== callingUser!.id) {
      return json({ error: "Only the org owner can add members" }, 403);
    }

    const { data: userList, error: listError } =
      await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listError) throw listError;

    const foundUser = userList.users.find(
      (user) => user.email?.trim().toLowerCase() === normalizedEmail,
    );

    if (!foundUser) {
      return json({ status: "pending", email: normalizedEmail });
    }

    if (!isKentMethodistGoogleUser(foundUser)) {
      return json({
        error: "That address must first sign in through the kentmethodist.org Google Workspace",
      }, 400);
    }

    const { data: existing } = await supabaseAdmin
      .from("org_members")
      .select("user_id")
      .eq("org_id", orgId)
      .eq("user_id", foundUser.id)
      .maybeSingle();

    if (existing) return json({ status: "already_member", uid: foundUser.id });

    const { error: insertError } = await supabaseAdmin.from("org_members").insert({
      org_id: orgId,
      user_id: foundUser.id,
      role: "member",
    });
    if (insertError) throw insertError;

    return json({
      status: "added",
      uid: foundUser.id,
      displayName: foundUser.user_metadata?.full_name ||
        foundUser.user_metadata?.name || normalizedEmail,
    });
  } catch (error) {
    console.error("resolve-member-email error:", error);
    return json({ error: (error as Error).message || "Internal error" }, 500);
  }
});
