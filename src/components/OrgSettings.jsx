import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { useOrg } from '../context/useOrg';
import { Settings, Server, Save, Eye, EyeOff } from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import Card from './ui/Card';
import MemberManager from './MemberManager';
import HeaderImageUpload from './HeaderImageUpload';
import ThemePicker from './ThemePicker';

export default function OrgSettings({ onBack }) {
    const { currentOrg, setCurrentOrg } = useOrg();
    const [form, setForm] = useState({
        name: currentOrg?.name || '',
        default_header_image_url: currentOrg?.default_header_image_url || '',
        default_theme: currentOrg?.default_theme || null,
        smtpHost: currentOrg?.smtp_config?.host || '',
        smtpPort: String(currentOrg?.smtp_config?.port || '465'),
        smtpUser: currentOrg?.smtp_config?.auth?.user || '',
        smtpPass: currentOrg?.smtp_config?.auth?.user ? '********' : '',
        fromName: currentOrg?.smtp_config?.fromName || '',
        fromEmail: currentOrg?.smtp_config?.fromEmail || '',
    });
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saved, setSaved] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
        setSaved(false);
    };

    const handleSave = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) {
            setError('Organization name is required');
            return;
        }

        if (form.smtpHost.trim()) {
            const port = parseInt(form.smtpPort) || 465;
            if (![25, 465, 587, 2525].includes(port)) {
                setError(`Port ${port} is not a valid standard outbound SMTP port. Do not use incoming IMAP ports like 993.`);
                return;
            }
            if (!form.smtpUser.trim() || !form.smtpPass) {
                setError('SMTP Username and Password are strictly required if an SMTP Host is provided.');
                return;
            }
        }

        setLoading(true);
        setError('');

        try {
            const updates = {
                name: form.name.trim(),
                default_header_image_url: form.default_header_image_url || null,
                default_theme: form.default_theme || null,
            };

            // Process secure SMTP config via our PostgreSQL RPC
            if (form.smtpHost.trim()) {
                const { error: rpcError } = await supabase.rpc('secure_smtp_config', {
                    p_org_id: currentOrg.id,
                    p_host: form.smtpHost.trim(),
                    p_port: parseInt(form.smtpPort) || 465,
                    p_user: form.smtpUser.trim(),
                    p_pass: form.smtpPass, // The RPC handles the '********' ignore case natively
                    p_from_email: form.fromEmail.trim() || form.smtpUser.trim(),
                    p_from_name: form.fromName.trim() || form.name.trim()
                });
                
                if (rpcError) throw rpcError;
                
                // Keep UI in sync locally without exposing password logic
                updates.smtp_config = {
                    host: form.smtpHost.trim(),
                    port: parseInt(form.smtpPort) || 465,
                    fromName: form.fromName.trim() || form.name.trim(),
                    fromEmail: form.fromEmail.trim(),
                    auth: { user: form.smtpUser.trim() }
                };
            } else {
                updates.smtp_config = null;
            }

            const { error: updateErr } = await supabase
                .from('organizations')
                .update(updates)
                .eq('id', currentOrg.id);

            if (updateErr) throw updateErr;

            setCurrentOrg({ ...currentOrg, ...updates });
            setSaved(true);
            setTimeout(() => setSaved(false), 3000);
        } catch (err) {
            console.error('Error updating org:', err);
            setError(err.message || 'Failed to save');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-2xl mx-auto space-y-8">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="bg-primary/10 p-2 rounded-lg">
                        <Settings className="w-6 h-6 text-primary" />
                    </div>
                    <h2 className="text-xl font-bold text-slate-900">Organization Settings</h2>
                </div>
                <Button variant="ghost" onClick={onBack}>← Back</Button>
            </div>

            {/* Branding / Default Header */}
            <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">Organization Branding</h3>
                <p className="text-sm text-slate-500 mb-6">
                    Set a default header image and theme. These will automatically be applied to any new event you create.
                </p>
                
                <div className="space-y-8">
                    <div>
                        <Label className="mb-2 block">Default Header Image</Label>
                        <HeaderImageUpload
                            imageUrl={form.default_header_image_url}
                            orgId={currentOrg.id}
                            eventId="org-default"
                            onChange={(url) => setForm(prev => ({ ...prev, default_header_image_url: url }))}
                        />
                    </div>

                    <div className="border-t border-slate-100 pt-6">
                        <Label className="mb-2 block">Default Theme Colors</Label>
                        <ThemePicker
                            theme={form.default_theme}
                            onChange={(theme) => setForm((prev) => ({ ...prev, default_theme: theme }))}
                        />
                    </div>
                </div>
            </Card>

            {/* Organization Details */}
            <Card className="p-6">
                <h3 className="text-lg font-semibold text-slate-900 mb-4">General</h3>
                <form onSubmit={handleSave} className="space-y-4">
                    <div>
                        <Label htmlFor="org-name-edit" required>Organization Name</Label>
                        <Input
                            id="org-name-edit"
                            name="name"
                            value={form.name}
                            onChange={handleChange}
                        />
                    </div>

                    <div className="border-t border-slate-200 pt-4">
                        <div className="flex items-center gap-2 mb-2">
                            <Server className="w-4 h-4 text-slate-400" />
                            <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Email Configuration</h4>
                        </div>
                        <p className="text-xs text-slate-500 mb-4">
                            Configure connection details for your Outgoing Mail Server (SMTP) to send automated confirmation emails.
                        </p>
                        <div className="space-y-4">
                            <div className="grid grid-cols-3 gap-3">
                                <div className="col-span-2">
                                    <Label htmlFor="smtp-host-edit">SMTP Host</Label>
                                    <Input id="smtp-host-edit" name="smtpHost" value={form.smtpHost} onChange={handleChange} placeholder="mail.example.org" />
                                </div>
                                <div>
                                    <Label htmlFor="smtp-port-edit">Port</Label>
                                    <Input id="smtp-port-edit" name="smtpPort" type="number" value={form.smtpPort} onChange={handleChange} />
                                </div>
                            </div>
                            <div>
                                <Label htmlFor="smtp-user-edit" required={!!form.smtpHost.trim()}>SMTP Username</Label>
                                <Input id="smtp-user-edit" name="smtpUser" value={form.smtpUser} onChange={handleChange} placeholder="user@example.org" />
                            </div>
                            <div>
                                <Label htmlFor="smtp-pass-edit" required={!!form.smtpHost.trim()}>SMTP Password</Label>
                                <div className="relative">
                                    <Input
                                        id="smtp-pass-edit"
                                        name="smtpPass"
                                        type={showPassword ? 'text' : 'password'}
                                        value={form.smtpPass}
                                        onChange={handleChange}
                                        placeholder="••••••••"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowPassword((v) => !v)}
                                        className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
                                        tabIndex={-1}
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                            <div>
                                <Label htmlFor="from-name-edit">From Name</Label>
                                <Input id="from-name-edit" name="fromName" value={form.fromName} onChange={handleChange} />
                            </div>
                            <div>
                                <Label htmlFor="from-email-edit">From Email</Label>
                                <Input id="from-email-edit" name="fromEmail" type="email" value={form.fromEmail} onChange={handleChange} />
                            </div>
                        </div>
                    </div>

                    {error && (
                        <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
                    )}

                    <div className="flex items-center gap-3">
                        <Button type="submit" loading={loading}>
                            <Save className="w-4 h-4" />
                            Save Settings
                        </Button>
                        {saved && <span className="text-sm text-success font-medium">✓ Saved</span>}
                    </div>
                </form>
            </Card>

            {/* Member Management */}
            <MemberManager />
        </div>
    );
}
