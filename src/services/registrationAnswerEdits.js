import { supabase } from './supabase';

const codedError = (code) => Object.assign(new Error(code), { code });

export async function updateRegistrationAnswers(payload) {
  const { data, error } = await supabase.functions.invoke(
    'update-registration-answers',
    { body: payload },
  );

  if (error) {
    let responseBody;
    try {
      responseBody = await error.context?.json?.();
    } catch {
      responseBody = null;
    }
    throw codedError(responseBody?.error || 'save_failed');
  }

  return data;
}

export async function listRegistrationAnswerEdits(registrationId, orgId) {
  const { data, error } = await supabase.from('registration_answer_edits')
    .select('*')
    .eq('registration_id', registrationId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (error) throw codedError('history_failed');
  return data || [];
}
