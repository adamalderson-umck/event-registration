import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  from: vi.fn(),
  select: vi.fn(),
  registrationEq: vi.fn(),
  orgEq: vi.fn(),
  order: vi.fn(),
}));

vi.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: mocks.invoke },
    from: mocks.from,
  },
}));

import {
  listRegistrationAnswerEdits,
  updateRegistrationAnswers,
} from '../registrationAnswerEdits';

describe('registration answer edit service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.from.mockReturnValue({ select: mocks.select });
    mocks.select.mockReturnValue({ eq: mocks.registrationEq });
    mocks.registrationEq.mockReturnValue({ eq: mocks.orgEq });
    mocks.orgEq.mockReturnValue({ order: mocks.order });
  });

  it('invokes the answer update function with the exact payload', async () => {
    const payload = {
      registrationId: 'registration-1',
      orgId: 'org-1',
      expectedFormData: { plate: 'TEMP' },
      answers: { plate: 'ABC123' },
    };
    const result = { registration: { id: 'registration-1' }, edit: { id: 'edit-1' } };
    mocks.invoke.mockResolvedValue({ data: result, error: null });

    await expect(updateRegistrationAnswers(payload)).resolves.toEqual(result);
    expect(mocks.invoke).toHaveBeenCalledWith('update-registration-answers', {
      body: payload,
    });
  });

  it('preserves stable endpoint error codes', async () => {
    mocks.invoke.mockResolvedValue({
      data: null,
      error: {
        context: { json: vi.fn(async () => ({ error: 'edit_conflict' })) },
      },
    });

    await expect(updateRegistrationAnswers({})).rejects.toMatchObject({
      code: 'edit_conflict',
    });
  });

  it('uses save_failed when the endpoint error has no stable body', async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: new Error('network') });

    await expect(updateRegistrationAnswers({})).rejects.toMatchObject({
      code: 'save_failed',
    });
  });

  it('lists newest history entries for the registration and organization', async () => {
    const entries = [{ id: 'edit-1' }];
    mocks.order.mockResolvedValue({ data: entries, error: null });

    await expect(listRegistrationAnswerEdits('registration-1', 'org-1'))
      .resolves.toEqual(entries);
    expect(mocks.from).toHaveBeenCalledWith('registration_answer_edits');
    expect(mocks.select).toHaveBeenCalledWith('*');
    expect(mocks.registrationEq).toHaveBeenCalledWith(
      'registration_id',
      'registration-1',
    );
    expect(mocks.orgEq).toHaveBeenCalledWith('org_id', 'org-1');
    expect(mocks.order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('maps history failures without exposing database messages', async () => {
    mocks.order.mockResolvedValue({ data: null, error: new Error('database detail') });

    await expect(listRegistrationAnswerEdits('registration-1', 'org-1'))
      .rejects.toMatchObject({ code: 'history_failed' });
  });
});
