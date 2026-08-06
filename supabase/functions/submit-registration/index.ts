import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import {
  createSubmitRegistrationHandler,
  type RegistrationAdminClient,
} from './handler.ts';

function requiredEnvironment(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error('Missing required function configuration');
  return value;
}

const expectedHostnames = requiredEnvironment('TURNSTILE_HOSTNAMES')
  .split(',')
  .map((hostname) => hostname.trim())
  .filter(Boolean);
if (expectedHostnames.length === 0) throw new Error('Missing required function configuration');

const adminClient = createClient(
  requiredEnvironment('SUPABASE_URL'),
  requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY'),
  { auth: { persistSession: false, autoRefreshToken: false } },
) as unknown as RegistrationAdminClient;

const handler = createSubmitRegistrationHandler({
  adminClient,
  turnstileSecret: requiredEnvironment('TURNSTILE_SECRET'),
  expectedHostnames,
  expectedAction: requiredEnvironment('TURNSTILE_ACTION'),
});

Deno.serve(handler);
