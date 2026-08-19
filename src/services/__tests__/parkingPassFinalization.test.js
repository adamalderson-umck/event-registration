import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), select: vi.fn(), registrationEq: vi.fn(),
  orgEq: vi.fn(), order: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: { rpc: mocks.rpc, from: mocks.from },
}));

import {
  listParkingPassFinalizationEvents,
  setParkingPassFinalization,
} from '../parkingPassFinalization';

describe('parking pass finalization service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ eq: mocks.registrationEq });
    mocks.registrationEq.mockReturnValue({ eq: mocks.orgEq });
    mocks.orgEq.mockReturnValue({ order: mocks.order });
  });

  it('sends the exact finalization RPC arguments', async () => {
    const result = { ok: true, registration: { id: 'registration-1' }, event: { id: 'audit-1' } };
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    await expect(setParkingPassFinalization({
      registrationId: 'registration-1', orgId: 'org-1', finalized: true,
    })).resolves.toEqual(result);
    expect(mocks.rpc).toHaveBeenCalledWith('finalize_parking_pass', {
      p_registration_id: 'registration-1', p_org_id: 'org-1',
    });
  });

  it('sends the observed timestamp when undoing', async () => {
    const result = { ok: true, registration: { id: 'registration-1' }, event: { id: 'audit-2' } };
    mocks.rpc.mockResolvedValue({ data: result, error: null });
    await setParkingPassFinalization({ registrationId: 'registration-1', orgId: 'org-1',
      finalized: false, expectedFinalizedAt: '2026-08-19T14:30:00Z' });
    expect(mocks.rpc).toHaveBeenCalledWith('undo_parking_pass_finalization', {
      p_registration_id: 'registration-1', p_org_id: 'org-1',
      p_expected_finalized_at: '2026-08-19T14:30:00Z',
    });
  });

  it.each(['not_eligible', 'finalization_conflict', 'forbidden'])
  ('preserves the stable %s response code', async (code) => {
    mocks.rpc.mockResolvedValue({ data: { ok: false, code }, error: null });
    await expect(setParkingPassFinalization({
      registrationId: 'registration-1', orgId: 'org-1', finalized: true,
    })).rejects.toMatchObject({ code });
  });

  it('maps transport failures without exposing database details', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('private detail') });
    await expect(setParkingPassFinalization({})).rejects.toMatchObject({ code: 'transition_failed' });
  });

  it('lists newest organization-scoped events', async () => {
    const entries = [{ id: 'audit-1' }];
    mocks.order.mockResolvedValue({ data: entries, error: null });
    await expect(listParkingPassFinalizationEvents('registration-1', 'org-1'))
      .resolves.toEqual(entries);
    expect(mocks.from).toHaveBeenCalledWith('parking_pass_finalization_events');
    expect(mocks.select).toHaveBeenCalledWith('*');
    expect(mocks.registrationEq).toHaveBeenCalledWith('registration_id', 'registration-1');
    expect(mocks.orgEq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(mocks.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });
});
