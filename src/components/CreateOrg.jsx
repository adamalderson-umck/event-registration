import React, { useState } from 'react';
import { supabase } from '../services/supabase';
import { Building2, Mail, Server, Plus, Eye, EyeOff } from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import Card from './ui/Card';

export default function CreateOrg({ onCreated }) {
    const [form, setForm] = useState({
        name: '',
        smtpHost: '',
        smtpPort: '465',
        smtpUser: '',
        smtpPass: '',
        fromName: '',
        fromEmail: '',
    });
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!form.name.trim()) {
            setError('Organization name is required');
            return;
        }

        if (form.smtpHost.trim()) {
            const port = parseInt(form.smtpPort) || 465;
            if (![25, 465, 587, 2525].includes(port)) {
                setError(`Port ${port} is not a valid standard outbound SMTP port. Do not use incoming IMAP specific ports like 993.`);
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
            const { data: { user } } = await supabase.auth.getUser();
            if (!user) throw new Error('Not authenticated');

            const baseSlug = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
            const suffix = Math.random().toString(16).slice(2, 6);
            const slug = `${baseSlug}-${suffix}`;

            // First create the organization without the SMTP config
            const orgData = {
                name: form.name.trim(),
                slug: slug,
                owner_uid: user.id
            };

            const { data: orgDatalist, error: insertError } = await supabase
                .from('organizations')
                .insert(orgData)
                .select();

            if (insertError) throw insertError;
            const newOrg = orgDatalist[0];

            // Setup secure SMTP via RPC if host was provided
            if (form.smtpHost.trim()) {
                const { error: rpcError } = await supabase.rpc('secure_smtp_config', {
                    p_org_id: newOrg.id,
                    p_host: form.smtpHost.trim(),
                    p_port: parseInt(form.smtpPort) || 465,
                    p_user: form.smtpUser.trim(),
                    p_pass: form.smtpPass, // Sent securely over HTTPS, not stored raw
                    p_from_email: form.fromEmail.trim() || form.smtpUser.trim(),
                    p_from_name: form.fromName.trim() || form.name.trim()
                });
                
                if (rpcError) {
                    console.error('SMTP Setup failed (Org created, emails disabled):', rpcError);
                    // Non-fatal, just log and optionally alert
                }
            }

            // Add self as owner member
            const { error: memberErr } = await supabase
                .from('org_members')
                .insert({
                    org_id: newOrg.id,
                    user_id: user.id,
                    role: 'owner',
                });

            if (memberErr) throw memberErr;

            onCreated(newOrg);
        } catch (err) {
            console.error('Error creating organization:', err);
            setError(err.message || 'Failed to create organization');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Card className="max-w-lg mx-auto p-8">
            <div className="flex items-center gap-3 mb-6">
                <div className="bg-primary/10 p-2 rounded-lg">
                    <Building2 className="w-6 h-6 text-primary" />
                </div>
                <div>
                    <h2 className="text-xl font-bold text-slate-900">Create Organization</h2>
                    <p className="text-sm text-slate-500">Set up your organization to start managing events</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* Organization Name */}
                <div>
                    <Label htmlFor="org-name" required>Organization Name</Label>
                    <Input
                        id="org-name"
                        name="name"
                        value={form.name}
                        onChange={handleChange}
                        placeholder="e.g. United Methodist Church of Kent"
                    />
                </div>

                {/* SMTP Configuration (Optional) */}
                <div className="border-t border-slate-200 pt-6">
                    <div className="flex items-center gap-2 mb-4">
                        <Server className="w-4 h-4 text-slate-400" />
                        <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">
                            Email Configuration
                            <span className="text-slate-400 font-normal normal-case ml-1">(optional)</span>
                        </h3>
                    </div>
                    <p className="text-xs text-slate-500 mb-4">
                        Configure connection details for your Outgoing Mail Server (SMTP) to send automated confirmation emails.
                    </p>

                    <div className="space-y-4">
                        <div className="grid grid-cols-3 gap-3">
                            <div className="col-span-2">
                                <Label htmlFor="smtp-host">SMTP Host</Label>
                                <Input
                                    id="smtp-host"
                                    name="smtpHost"
                                    value={form.smtpHost}
                                    onChange={handleChange}
                                    placeholder="mail.example.org"
                                />
                            </div>
                            <div>
                                <Label htmlFor="smtp-port">Port</Label>
                                <Input
                                    id="smtp-port"
                                    name="smtpPort"
                                    type="number"
                                    value={form.smtpPort}
                                    onChange={handleChange}
                                />
                            </div>
                        </div>

                        <div>
                            <Label htmlFor="smtp-user" required={!!form.smtpHost.trim()}>SMTP Username</Label>
                            <Input
                                id="smtp-user"
                                name="smtpUser"
                                value={form.smtpUser}
                                onChange={handleChange}
                                placeholder="user@example.org"
                            />
                        </div>

                        <div>
                            <Label htmlFor="smtp-pass" required={!!form.smtpHost.trim()}>SMTP Password</Label>
                            <div className="relative">
                                <Input
                                    id="smtp-pass"
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
                            <Label htmlFor="from-name">From Name</Label>
                            <Input
                                id="from-name"
                                name="fromName"
                                value={form.fromName}
                                onChange={handleChange}
                                placeholder="My Church Events"
                            />
                        </div>

                        <div>
                            <Label htmlFor="from-email">From Email</Label>
                            <Input
                                id="from-email"
                                name="fromEmail"
                                type="email"
                                value={form.fromEmail}
                                onChange={handleChange}
                                placeholder="events@example.org"
                            />
                        </div>
                    </div>
                </div>

                {error && (
                    <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                        {error}
                    </p>
                )}

                <Button type="submit" loading={loading} className="w-full" size="lg">
                    <Plus className="w-4 h-4" />
                    Create Organization
                </Button>
            </form>
        </Card>
    );
}
