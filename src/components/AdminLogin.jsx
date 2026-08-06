import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { LogIn, Loader2, CalendarDays } from 'lucide-react';
import Button from './ui/Button';
import Card from './ui/Card';

export default function AdminLogin() {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleGoogleSignIn = async () => {
        setLoading(true);
        setError('');

        try {
            const { error: authError } = await supabase.auth.signInWithOAuth({
                provider: 'google',
                options: {
                    redirectTo: `${window.location.origin}/?admin=true`,
                    // This guides Google's account chooser; Supabase enforces the domain server-side.
                    queryParams: {
                        hd: 'kentmethodist.org',
                        prompt: 'select_account',
                    },
                },
            });

            if (authError) throw authError;
            // OAuth redirects — onAuthenticated is handled by App.jsx auth state listener
        } catch (err) {
            console.error('Sign-in error:', err);
            setError(err.message || 'Failed to sign in');
            setLoading(false);
        }
    };

    return (
        <div className="max-w-md mx-auto py-12">
            <Card className="p-8 text-center">
                <div className="inline-flex bg-primary/10 p-3 rounded-full mb-6">
                    <CalendarDays className="w-8 h-8 text-primary" />
                </div>

                <h1 className="text-2xl font-bold text-slate-900 mb-2">Admin Portal</h1>
                <p className="text-slate-500 mb-8">
                    Sign in with your @kentmethodist.org Google Workspace account to manage events
                </p>

                <Button
                    onClick={handleGoogleSignIn}
                    loading={loading}
                    size="lg"
                    className="w-full"
                >
                    <LogIn className="w-4 h-4" />
                    Sign in with Google
                </Button>

                {error && (
                    <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2 mt-4">
                        {error}
                    </p>
                )}
            </Card>
        </div>
    );
}
