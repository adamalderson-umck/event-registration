import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const { listEditsMock } = vi.hoisted(() => ({ listEditsMock: vi.fn() }));

vi.mock('../../services/registrationAnswerEdits', () => ({
  listRegistrationAnswerEdits: listEditsMock,
}));

import RegistrationEditHistory from '../RegistrationEditHistory';

const entry = {
  id: 'edit-1',
  editor_user_id: 'user-1',
  editor_display_name: 'Admin User',
  created_at: '2026-08-07T16:00:00Z',
  changes: [
    { fieldId: 'plate', fieldLabel: 'License Plate', before: 'TEMP', after: 'ABC123' },
    { fieldId: 'choices', fieldLabel: 'Choices', before: ['A'], after: ['A', 'B'] },
    { fieldId: 'approved', fieldLabel: 'Approved', before: false, after: true },
    { fieldId: 'removed', fieldLabel: 'Removed', before: 'old', after: null },
  ],
};

describe('RegistrationEditHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listEditsMock.mockResolvedValue([entry]);
  });

  it('is collapsed by default and loads newest history when expanded', async () => {
    const user = userEvent.setup();
    render(<RegistrationEditHistory
      registrationId="registration-1"
      orgId="org-1"
      refreshKey={0}
    />);

    const toggle = screen.getByRole('button', { name: /edit history/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(listEditsMock).not.toHaveBeenCalled();

    await user.click(toggle);

    expect(await screen.findByText('Admin User')).toBeInTheDocument();
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('License Plate')).toBeInTheDocument();
    expect(screen.getByText('TEMP')).toBeInTheDocument();
    expect(screen.getByText('ABC123')).toBeInTheDocument();
    expect(screen.getByText('A, B')).toBeInTheDocument();
    expect(screen.getAllByText('Yes').length).toBeGreaterThan(0);
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
    expect(listEditsMock).toHaveBeenCalledWith('registration-1', 'org-1');
  });

  it('shows loading and empty states', async () => {
    const user = userEvent.setup();
    let resolveEntries;
    listEditsMock.mockReturnValue(new Promise((resolve) => { resolveEntries = resolve; }));
    render(<RegistrationEditHistory
      registrationId="registration-1"
      orgId="org-1"
      refreshKey={0}
    />);

    await user.click(screen.getByRole('button', { name: /edit history/i }));
    expect(screen.getByRole('status')).toHaveTextContent('Loading edit history');
    resolveEntries([]);
    expect(await screen.findByText('No answer edits recorded.')).toBeInTheDocument();
  });

  it('shows a stable failure with retry and user-id fallback', async () => {
    const user = userEvent.setup();
    listEditsMock
      .mockRejectedValueOnce(Object.assign(new Error('history_failed'), { code: 'history_failed' }))
      .mockResolvedValueOnce([{ ...entry, editor_display_name: '' }]);
    render(<RegistrationEditHistory
      registrationId="registration-1"
      orgId="org-1"
      refreshKey={0}
    />);

    await user.click(screen.getByRole('button', { name: /edit history/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to load edit history.');
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('user-1')).toBeInTheDocument();
  });

  it('refetches an expanded history when refreshKey changes', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<RegistrationEditHistory
      registrationId="registration-1"
      orgId="org-1"
      refreshKey={0}
    />);
    await user.click(screen.getByRole('button', { name: /edit history/i }));
    await screen.findByText('Admin User');

    rerender(<RegistrationEditHistory
      registrationId="registration-1"
      orgId="org-1"
      refreshKey={1}
    />);

    await waitFor(() => expect(listEditsMock).toHaveBeenCalledTimes(2));
  });
});
