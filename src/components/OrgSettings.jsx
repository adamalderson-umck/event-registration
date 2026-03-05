import React, { useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../services/firebase';
import { useOrg } from '../context/useOrg';
import { Settings, Server, Save } from 'lucide-react';
import Button from './ui/Button';
import Input from './ui/Input';
import Label from './ui/Label';
import Card from './ui/Card';
import MemberManager from './MemberManager';

export default function OrgSettings({ onBack }) {
    const { currentOrg, setCurrentOrg } = useOrg();
    const [form, setForm] = useState({
        name: currentOrg?.name || '',
        smtpHost: currentOrg?.smtpConfig?.host || '',
        smtpPort: String(currentOrg?.smtpConfig?.port || '465'),
        fromName: currentOrg?.smtpConfig?.fromName || '',
        fromEmail: currentOrg?.smtpConfig?.fromEmail || '',
    });
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

        setLoading(true);
        setError('');

        try {
            const orgRef = doc(db, 'organizations', currentOrg.id);
            const updates = {
                name: form.name.trim(),
                updatedAt: serverTimestamp(),
            };

            if (form.smtpHost.trim()) {
                updates.smtpConfig = {
                    host: form.smtpHost.trim(),
                    port: parseInt(form.smtpPort) || 465,
                    fromName: form.fromName.trim() || form.name.trim(),
                    fromEmail: form.fromEmail.trim(),
                };
            }

            await updateDoc(orgRef, updates);
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
                        <div className="flex items-center gap-2 mb-4">
                            <Server className="w-4 h-4 text-slate-400" />
                            <h4 className="text-sm font-semibold text-slate-700 uppercase tracking-wide">Email Configuration</h4>
                        </div>
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
