import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { auth, authState, rpc } = vi.hoisted(() => {
  const authState = { callback: null };

  return {
    authState,
    auth: {
      getSession: vi.fn(),
      getUser: vi.fn(),
      onAuthStateChange: vi.fn((callback) => {
        authState.callback = callback;
        return {
          data: { subscription: { unsubscribe: vi.fn() } },
        };
      }),
      signOut: vi.fn(),
    },
    rpc: vi.fn(),
  };
});

vi.mock('../services/supabase', () => ({
  supabase: { auth, rpc },
}));

vi.mock('../components/AdminLogin', () => ({
  default: () => <div>Admin login</div>,
}));

vi.mock('../components/AdminDashboard', () => ({
  default: () => <div>Admin dashboard</div>,
}));

import App from '../App';

describe('admin access routing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authState.callback = null;
    window.history.replaceState({}, '', '/admin');
  });

  it('renders the dashboard only after the server authorizes the signed-in user', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'allowed-user' } } } });
    auth.getUser.mockResolvedValue({
      data: { user: { id: 'allowed-user', email: 'admin@kentmethodist.org' } },
      error: null,
    });
    rpc.mockResolvedValue({ data: true, error: null });

    render(<App />);

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledWith('is_kentmethodist_admin');
  });

  it('denies a signed-in user whom the server does not authorize', async () => {
    auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'outside-user' } } } });
    auth.getUser.mockResolvedValue({
      data: { user: { id: 'outside-user', email: 'person@gmail.com' } },
      error: null,
    });
    rpc.mockResolvedValue({ data: false, error: null });

    render(<App />);

    expect(await screen.findByRole('heading', { name: 'Admin access restricted' })).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });

  it('returns a signed-out user to the admin login', async () => {
    auth.getSession.mockResolvedValue({ data: { session: null } });
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });

    render(<App />);

    expect(await screen.findByText('Admin login')).toBeInTheDocument();
    await waitFor(() => expect(rpc).not.toHaveBeenCalled());
  });

  it('returns a mounted admin dashboard to login when the session signs out', async () => {
    auth.getUser.mockResolvedValue({
      data: { user: { id: 'allowed-user', email: 'admin@kentmethodist.org' } },
      error: null,
    });
    rpc.mockResolvedValue({ data: true, error: null });

    render(<App />);

    expect(await screen.findByText('Admin dashboard')).toBeInTheDocument();

    act(() => authState.callback('SIGNED_OUT', null));

    expect(await screen.findByText('Admin login')).toBeInTheDocument();
    expect(screen.queryByText('Admin dashboard')).not.toBeInTheDocument();
  });
});
