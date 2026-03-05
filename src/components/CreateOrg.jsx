import React, { useState } from 'react';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../services/firebase';
import { Building2, Mail, Server, Plus } from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import Card from './ui/Card';

export default function CreateOrg({ onCreated }) {
    const [form, setForm] = useState({
        name: '',
        smtpHost: '',
        smtpPort: '465',
        fromName: '',
        fromEmail: '',
    });
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

        setLoading(true);
        setError('');

        try {
            const user = auth.currentUser;
            if (!user) throw new Error('Not authenticated');

            const slug = form.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

            const orgData = {
                name: form.name.trim(),
                slug,
                ownerUid: user.uid,
                members: [user.uid],
                createdAt: serverTimestamp(),
            };

            // Only add SMTP config if host is provided
            if (form.smtpHost.trim()) {
                orgData.smtpConfig = {
                    host: form.smtpHost.trim(),
                    port: parseInt(form.smtpPort) || 465,
                    fromName: form.fromName.trim() || form.name.trim(),
                    fromEmail: form.fromEmail.trim(),
                };
            }

            const docRef = await addDoc(collection(db, 'organizations'), orgData);
            onCreated({ id: docRef.id, ...orgData });
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
                        Configure SMTP to send confirmation emails. You can set this up later.
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
