import React, { useState, useEffect, useMemo } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../services/firebase';
import {
    ArrowLeft, Search, Printer, FileText, ClipboardList,
    BarChart3, Users, Loader2, X, Eye
} from 'lucide-react';
import {
    printIndividualRegistration,
    printRegistrationTable,
    printSignInSheet,
    printEventSummary,
} from '../utils/printReports';
import Button from './ui/Button';
import Card from './ui/Card';
import Input from './ui/Input';
import Select from './ui/Select';

export default function RegistrationViewer({ orgId, eventId, event, onBack }) {
    const [registrations, setRegistrations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedReg, setSelectedReg] = useState(null);

    // Real-time listener
    useEffect(() => {
        if (!orgId || !eventId) return;

        const regsRef = collection(db, 'organizations', orgId, 'registrations');
        const q = query(regsRef, orderBy('createdAt', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const regs = snapshot.docs
                .map((doc) => ({ id: doc.id, ...doc.data() }))
                .filter((reg) => reg.eventId === eventId);
            setRegistrations(regs);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [orgId, eventId]);

    const formFields = event?.formFields || [];

    // Filtered registrations
    const filtered = useMemo(() => {
        let result = registrations;

        if (statusFilter !== 'all') {
            result = result.filter((r) => r.status === statusFilter);
        }

        if (searchTerm.trim()) {
            const term = searchTerm.toLowerCase();
            result = result.filter((reg) =>
                formFields.some((field) => {
                    const val = reg.formData?.[field.id];
                    if (!val) return false;
                    const str = Array.isArray(val) ? val.join(' ') : String(val);
                    return str.toLowerCase().includes(term);
                })
            );
        }

        return result;
    }, [registrations, statusFilter, searchTerm, formFields]);

    const statusColors = {
        confirmed: 'bg-green-50 text-green-700',
        waitlisted: 'bg-amber-50 text-amber-700',
        cancelled: 'bg-red-50 text-red-700',
        pending: 'bg-slate-100 text-slate-600',
    };

    const formatValue = (val) => {
        if (val === null || val === undefined || val === '') return '—';
        if (Array.isArray(val)) return val.join(', ');
        return String(val);
    };

    if (loading) {
        return (
            <div className="flex justify-center py-20">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
            </div>
        );
    }

    // Detail modal
    if (selectedReg) {
        return (
            <div className="space-y-4">
                <div className="flex items-center justify-between">
                    <Button variant="ghost" onClick={() => setSelectedReg(null)}>
                        <ArrowLeft className="w-4 h-4" /> Back to List
                    </Button>
                    <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => printIndividualRegistration(selectedReg, event)}
                    >
                        <Printer className="w-4 h-4" /> Print
                    </Button>
                </div>

                <Card className="p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-lg font-bold text-slate-900">Registration Details</h3>
                        <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${statusColors[selectedReg.status] || statusColors.pending}`}>
                            {selectedReg.status || 'pending'}
                        </span>
                    </div>

                    <div className="space-y-3">
                        {formFields.map((field) => (
                            <div key={field.id} className="grid grid-cols-3 gap-2 py-2 border-b border-slate-100 last:border-0">
                                <dt className="text-sm font-medium text-slate-500">{field.label}</dt>
                                <dd className="col-span-2 text-sm text-slate-900">
                                    {formatValue(selectedReg.formData?.[field.id])}
                                </dd>
                            </div>
                        ))}
                    </div>

                    <div className="mt-4 pt-4 border-t border-slate-200 text-xs text-slate-400 space-y-1">
                        <p>Payment: {selectedReg.paymentStatus || 'N/A'}{selectedReg.paymentMethod ? ` (${selectedReg.paymentMethod})` : ''}</p>
                        <p>Submitted: {selectedReg.createdAt?.toDate?.()
                            ? selectedReg.createdAt.toDate().toLocaleString()
                            : 'N/A'}</p>
                    </div>
                </Card>
            </div>
        );
    }

    return (
        <div className="space-y-4">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <Button variant="ghost" onClick={onBack}>
                        <ArrowLeft className="w-4 h-4" /> Back
                    </Button>
                    <div>
                        <h2 className="text-xl font-bold text-slate-900">{event?.title}</h2>
                        <p className="text-sm text-slate-400">{registrations.length} registrations</p>
                    </div>
                </div>
            </div>

            {/* Toolbar */}
            <div className="flex items-center gap-3 flex-wrap">
                <div className="relative flex-1 min-w-[200px] max-w-md">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search registrations..."
                        className="pl-9"
                    />
                    {searchTerm && (
                        <button
                            onClick={() => setSearchTerm('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-300 hover:text-slate-500 cursor-pointer"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    )}
                </div>

                <Select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    options={[
                        { value: 'all', label: 'All Statuses' },
                        { value: 'confirmed', label: 'Confirmed' },
                        { value: 'waitlisted', label: 'Waitlisted' },
                        { value: 'cancelled', label: 'Cancelled' },
                        { value: 'pending', label: 'Pending' },
                    ]}
                    className="w-40"
                />

                {/* Print Buttons */}
                <div className="flex gap-2 ml-auto">
                    <Button variant="secondary" size="sm" onClick={() => printRegistrationTable(filtered, event)} title="Print Registration Table">
                        <ClipboardList className="w-4 h-4" /> Table
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => printSignInSheet(filtered, event)} title="Print Sign-In Sheet">
                        <FileText className="w-4 h-4" /> Sign-In
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => printEventSummary(registrations, event)} title="Print Event Summary">
                        <BarChart3 className="w-4 h-4" /> Summary
                    </Button>
                </div>
            </div>

            {/* Table */}
            {filtered.length === 0 ? (
                <Card className="p-12 text-center">
                    <Users className="w-12 h-12 text-slate-200 mx-auto mb-4" />
                    <p className="text-lg font-semibold text-slate-400">
                        {registrations.length === 0 ? 'No registrations yet' : 'No matching registrations'}
                    </p>
                </Card>
            ) : (
                <Card className="overflow-hidden">
                    <div className="overflow-x-auto">
                        <table className="w-full">
                            <thead>
                                <tr className="bg-slate-50 border-b border-slate-200">
                                    {formFields.slice(0, 5).map((field) => (
                                        <th key={field.id} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">
                                            {field.label}
                                        </th>
                                    ))}
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filtered.map((reg) => (
                                    <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
                                        {formFields.slice(0, 5).map((field) => (
                                            <td key={field.id} className="px-4 py-3 text-sm text-slate-700 max-w-[200px] truncate">
                                                {formatValue(reg.formData?.[field.id])}
                                            </td>
                                        ))}
                                        <td className="px-4 py-3">
                                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${statusColors[reg.status] || statusColors.pending}`}>
                                                {reg.status || 'pending'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-3 text-right">
                                            <button
                                                onClick={() => setSelectedReg(reg)}
                                                className="text-primary hover:text-primary-dark text-sm font-medium inline-flex items-center gap-1 cursor-pointer"
                                            >
                                                <Eye className="w-3 h-3" /> View
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}
        </div>
    );
}
