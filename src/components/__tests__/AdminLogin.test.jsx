import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const { signInWithOAuth } = vi.hoisted(() => ({
  signInWithOAuth: vi.fn().mockResolvedValue({ error: null }),
}));

vi.mock('../../services/supabase', () => ({
  supabase: {
    auth: { signInWithOAuth },
  },
}));

import AdminLogin from '../AdminLogin';

it('hints the managed Google Workspace domain during sign-in', async () => {
  render(<AdminLogin />);

  fireEvent.click(screen.getByRole('button', { name: /sign in with google/i }));

  await waitFor(() => {
    expect(signInWithOAuth).toHaveBeenCalledWith({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/?admin=true`,
        queryParams: {
          hd: 'kentmethodist.org',
          prompt: 'select_account',
        },
      },
    });
  });
});
