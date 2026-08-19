import { supabase } from './supabase';

const codedError = (code) => Object.assign(new Error(code), { code });

export async function setParkingPassFinalization({
  registrationId, orgId, finalized, expectedFinalizedAt = null,
}) {
  const functionName = finalized
    ? 'finalize_parking_pass'
    : 'undo_parking_pass_finalization';
  const args = finalized
    ? { p_registration_id: registrationId, p_org_id: orgId }
    : {
        p_registration_id: registrationId,
        p_org_id: orgId,
        p_expected_finalized_at: expectedFinalizedAt,
      };
  const { data, error } = await supabase.rpc(functionName, args);
  if (error) throw codedError('transition_failed');
  if (!data?.ok) throw codedError(data?.code || 'transition_failed');
  return data;
}

export async function listParkingPassFinalizationEvents(registrationId, orgId) {
  const { data, error } = await supabase.from('parking_pass_finalization_events')
    .select('*')
    .eq('registration_id', registrationId)
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw codedError('history_failed');
  return data || [];
}
