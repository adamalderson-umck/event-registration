import { supabase } from './supabase';

const codedError = (code) => Object.assign(new Error(code), { code });

export async function listRegistrationEmailDeliveryStatuses(orgId, eventId) {
  const { data, error } = await supabase.rpc(
    'get_registration_email_delivery_statuses',
    { p_org_id: orgId, p_event_id: eventId },
  );
  if (error) throw codedError('email_status_failed');
  return new Map((data || []).map((row) => [row.registration_id, row]));
}

export async function retryRegistrationEmailDelivery({
  orgId,
  registrationId,
  deliveryId,
}) {
  const { data, error } = await supabase.rpc(
    'retry_registration_email_delivery',
    {
      p_org_id: orgId,
      p_registration_id: registrationId,
      p_delivery_id: deliveryId,
    },
  );
  if (error || !data) throw codedError('email_retry_failed');
  if (!data.ok) throw codedError(data.code || 'email_retry_failed');
  if (data.code !== 'queued') throw codedError('email_retry_failed');
  return data;
}
