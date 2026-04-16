import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabase';
import { UserCircle, Save, Loader2 } from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import Card from './ui/Card';

export default function UserSettings() {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');
    const [user, setUser] = useState(null);
    const [form, setForm] = useState({
        display_name: '',
    });

    useEffect(() => {
        let isMounted = true;
        const loadProfile = async () => {
            try {
                const { data: { user: authUser } } = await supabase.auth.getUser();
                if (!authUser) return;
                
                if (isMounted) setUser(authUser);

                const { data: profile, error: profileErr } = await supabase
                    .from('profiles')
                    .select('display_name')
                    .eq('id', authUser.id)
                    .single();

                if (profileErr) throw profileErr;

                if (isMounted) {
                    setForm({
                        display_name: profile.display_name || '',
                    });
                }
            } catch (err) {
                console.error('Error loading profile:', err);
                if (isMounted) setError('Failed to load user profile.');
            } finally {
                if (isMounted) setLoading(false);
            }
        };

        loadProfile();
        return () => { isMounted = false; };
    }, []);

    const handleChange = (e) => {
        setForm(prev => ({ ...prev, [e.target.name]: e.target.value }));
        setSaved(false);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        
        try {
            if (!user) throw new Error('Not authenticated');

            const { error: updateErr } = await supabase
                .from('profiles')
                .update({ display_name: form.display_name.trim() })
                .eq('id', user.id);

            if (updateErr) throw updateErr;

            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (err) {
            console.error('Error saving profile:', err);
            setError(err.message || 'Failed to save profile');
        } finally {
            setSaving(false);
        }
    };

    if (loading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <div className="flex items-center gap-3">
                <div className="bg-primary/10 p-2 rounded-lg">
                    <UserCircle className="w-6 h-6 text-primary" />
                </div>
                <h2 className="text-xl font-bold text-slate-900">My Profile Settings</h2>
            </div>

            <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">General Information</h3>
                
                <form onSubmit={handleSave} className="space-y-6">
                    <div>
                        <Label htmlFor="auth-email">Account Email</Label>
                        <Input
                            id="auth-email"
                            value={user?.email || ''}
                            disabled
                            className="bg-slate-50 text-slate-500 cursor-not-allowed"
                        />
                        <p className="text-xs text-slate-400 mt-1">Managed via authentication provider.</p>
                    </div>

                    <div>
                        <Label htmlFor="display-name">Display Name</Label>
                        <Input
                            id="display-name"
                            name="display_name"
                            value={form.display_name}
                            onChange={handleChange}
                            placeholder="e.g. John Doe"
                        />
                        <p className="text-xs text-slate-400 mt-1">Used when sending organizer invites or displaying your name to other administrators.</p>
                    </div>

                    {error && (
                        <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                            {error}
                        </p>
                    )}

                    <div className="flex items-center gap-3 pt-4 border-t border-slate-200">
                        <Button type="submit" loading={saving}>
                            <Save className="w-4 h-4" />
                            Save Profile
                        </Button>
                        {saved && <span className="text-sm text-success font-medium">✓ Saved</span>}
                    </div>
                </form>
            </Card>
        </div>
    );
}
