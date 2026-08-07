import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  type ApplyArgs,
  createUpdateRegistrationAnswersHandler,
} from './handler.ts';

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error('Missing function configuration');
  return value;
}

const supabaseUrl = requiredEnvironment('SUPABASE_URL');
const anonKey = requiredEnvironment('SUPABASE_ANON_KEY');
const admin = createClient(
  supabaseUrl,
  requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
);

Deno.serve((req: Request) => {
  const authorization = req.headers.get('Authorization') || '';
  const userClient = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: authorization } },
  });

  return createUpdateRegistrationAnswersHandler({
    async authenticate() {
      if (!authorization) return null;
      const { data: { user }, error } = await userClient.auth.getUser();
      if (error || !user) return null;
      return { id: user.id, email: user.email };
    },
    async isMember(orgId: string, userId: string) {
      const { data, error } = await admin.from('org_members')
        .select('user_id')
        .eq('org_id', orgId)
        .eq('user_id', userId)
        .maybeSingle();
      if (error) throw error;
      return Boolean(data);
    },
    async loadRegistration(id: string) {
      const { data, error } = await admin.from('registrations')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async loadEvent(id: string) {
      const { data, error } = await admin.from('events')
        .select('id,org_id,form_fields')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    async loadEditorName(user) {
      const { data, error } = await admin.from('profiles')
        .select('display_name')
        .eq('id', user.id)
        .maybeSingle();
      if (error) throw error;
      return data?.display_name?.trim() || user.email || user.id;
    },
    async applyEdit(args: ApplyArgs) {
      const { data, error } = await admin.rpc(
        'apply_registration_answer_edit',
        {
          p_registration_id: args.registrationId,
          p_org_id: args.orgId,
          p_event_id: args.eventId,
          p_editor_user_id: args.editorUserId,
          p_editor_display_name: args.editorDisplayName,
          p_expected_form_data: args.expectedFormData,
          p_new_form_data: args.newFormData,
          p_changes: args.changes,
        },
      );
      if (error) throw error;
      return data;
    },
    log(event) {
      console.error(JSON.stringify(event));
    },
  })(req);
});
