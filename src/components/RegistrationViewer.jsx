import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '../services/supabase';
import {
    ArrowLeft, Search, Printer, FileText, ClipboardList,
    BarChart3, Users, Loader2, X, Eye, Download, XCircle, Upload
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
import SignatureViewer from './SignatureViewer';
import { downloadCsv } from '../utils/exportCsv';
import { processCsvFile } from '../utils/importCsv';
import { getRegistrationWaiverStatuses } from '../utils/registrationWaiverStatus';
import { useRef } from 'react';

export default function RegistrationViewer({ orgId, eventId, event, onBack }) {
    const [registrations, setRegistrations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('all');
    const [selectedReg, setSelectedReg] = useState(null);
    const [cancellingId, setCancellingId] = useState(null);
    const [cancelError, setCancelError] = useState('');

    // Import states
    const fileInputRef = useRef(null);
    const [showImportModal, setShowImportModal] = useState(false);
    const [importData, setImportData] = useState(null);
    const [importMappings, setImportMappings] = useState({});
    const [importing, setImporting] = useState(false);
    const [importError, setImportError] = useState('');

    // Initial fetch + Realtime subscription
    useEffect(() => {
        if (!orgId || !eventId) return;

        const fetchRegistrations = async () => {
            const { data, error } = await supabase
                .from('registrations')
                .select('*')
                .eq('event_id', eventId)
                .eq('org_id', orgId)
                .order('created_at', { ascending: false });

            if (error) {
                console.error('Error fetching registrations:', error);
            } else {
                setRegistrations(data || []);
            }
            setLoading(false);
        };

        fetchRegistrations();

        // Realtime subscription
        const channel = supabase
            .channel(`registrations:${eventId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'registrations',
                filter: `event_id=eq.${eventId}`
            }, () => {
                fetchRegistrations();
            })
            .subscribe();

        return () => supabase.removeChannel(channel);
    }, [orgId, eventId]);

    const handleAdminCancel = async (regId) => {
        if (!confirm('Are you sure you want to cancel this registration? This will open up a spot and may promote someone from the waitlist.')) {
            return;
        }

        setCancellingId(regId);
        try {
            const { error: rpcErr } = await supabase.rpc('cancel_registration', {
                p_registration_id: regId,
                p_org_id: orgId,
            });

            if (rpcErr) throw rpcErr;
            
            if (selectedReg && selectedReg.id === regId) {
                setSelectedReg(prev => ({ ...prev, status: 'cancelled' }));
            }
        } catch (err) {
            console.error('Failed to cancel registration:', err);
            setCancelError('Failed to cancel: ' + (err.message || 'Unknown error'));
            setTimeout(() => setCancelError(''), 5000);
        } finally {
            setCancellingId(null);
        }
    };

    const handleFileSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            setImportError('');
            const result = await processCsvFile(file, formFields);
            setImportData(result);
            setImportMappings(result.inferredMappings);
            setShowImportModal(true);
        } catch (err) {
            setImportError('Failed to parse CSV: ' + err.message);
        }
        
        // Reset input
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handleImportConfirm = async () => {
        setImporting(true);
        setImportError('');

        try {
            const { headers, dataRows } = importData;
            
            const newRegistrations = dataRows.map(row => {
                const formData = {};
                headers.forEach((_, index) => {
                    const mappedFieldId = importMappings[index];
                    if (mappedFieldId) {
                        formData[mappedFieldId] = row[index] || '';
                    }
                });

                return {
                    org_id: orgId,
                    event_id: eventId,
                    status: 'confirmed',
                    form_data: formData,
                    signature_records: [],
                };
            });

            const { error } = await supabase
                .from('registrations')
                .insert(newRegistrations);

            if (error) throw error;

            setShowImportModal(false);
            setImportData(null);
            setImportMappings({});
        } catch (err) {
            console.error('Import failed:', err);
            setImportError('Failed to import: ' + err.message);
        } finally {
            setImporting(false);
        }
    };
    const formFields = useMemo(() => event?.form_fields || [], [event?.form_fields]);

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
                    const formData = getFormData(reg);
                    const val = formData[field.id];
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

    const getFormData = (reg) => {
        if (!reg?.form_data) return {};
        if (typeof reg.form_data === 'string') {
            try { return JSON.parse(reg.form_data); } catch { return {}; }
        }
        return reg.form_data;
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
                {cancelError && (
                    <div className="flex items-center justify-between gap-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg px-4 py-3">
                        <span>{cancelError}</span>
                        <button onClick={() => setCancelError('')} className="text-red-400 hover:text-red-600 shrink-0 cursor-pointer">✕</button>
                    </div>
                )}
                <div className="flex items-center justify-between">
                    <Button variant="ghost" onClick={() => setSelectedReg(null)}>
                        <ArrowLeft className="w-4 h-4" /> Back to List
                    </Button>
                    <div className="flex gap-2">
                        {selectedReg.status !== 'cancelled' && (
                            <Button
                                variant="danger"
                                size="sm"
                                onClick={() => handleAdminCancel(selectedReg.id)}
                                loading={cancellingId === selectedReg.id}
                            >
                                <XCircle className="w-4 h-4" /> Cancel Registration
                            </Button>
                        )}
                        <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => printIndividualRegistration(selectedReg, event)}
                        >
                            <Printer className="w-4 h-4" /> Print
                        </Button>
                    </div>
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
                                    {formatValue(getFormData(selectedReg)[field.id])}
                                </dd>
                            </div>
                        ))}
                    </div>

                    {/* Waiver Signatures */}
                    {Array.isArray(selectedReg.signature_records) && selectedReg.signature_records.length > 0 && (
                        <div className="mt-4">
                            <SignatureViewer registration={selectedReg} event={event} />
                        </div>
                    )}

                    <div className="mt-4 pt-4 border-t border-slate-200 text-xs text-slate-400 space-y-1">
                        <p>Payment: {selectedReg.payment_status || 'N/A'}{selectedReg.payment_method ? ` (${selectedReg.payment_method})` : ''}</p>
                        <p>Submitted: {selectedReg.created_at
                            ? new Date(selectedReg.created_at).toLocaleString()
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
                    <input
                        type="file"
                        accept=".csv"
                        className="hidden"
                        ref={fileInputRef}
                        onChange={handleFileSelect}
                    />
                    <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()} title="Import CSV">
                        <Upload className="w-4 h-4" /> Import
                    </Button>
                    <Button variant="secondary" size="sm" onClick={() => downloadCsv(
                        filtered,
                        formFields,
                        `${event?.title?.replace(/\s+/g, '_') || 'registrations'}.csv`
                    )} title="Export to CSV">
                        <Download className="w-4 h-4" /> CSV
                    </Button>
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
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Waiver</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Media</th>
                                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {filtered.map((reg) => {
                                    const { waiverStatus, mediaDecision } = getRegistrationWaiverStatuses(
                                        reg,
                                        event?.waivers
                                    );

                                    return (
                                        <tr key={reg.id} className="hover:bg-slate-50 transition-colors">
                                            {formFields.slice(0, 5).map((field) => (
                                                <td key={field.id} className="px-4 py-3 text-sm text-slate-700 max-w-[200px] truncate">
                                                    {formatValue(getFormData(reg)[field.id])}
                                                </td>
                                            ))}
                                            <td className="px-4 py-3 text-sm text-slate-700">
                                                {waiverStatus}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-slate-700">
                                                {mediaDecision}
                                            </td>
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
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                </Card>
            )}

            {/* Import Mapping Modal */}
            {showImportModal && importData && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50">
                    <Card className="w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
                        <div className="p-6 border-b border-slate-100 flex items-center justify-between shrink-0">
                            <h3 className="text-xl font-bold text-slate-900">Map CSV Columns</h3>
                            <button
                                onClick={() => setShowImportModal(false)}
                                className="text-slate-400 hover:text-slate-600 cursor-pointer"
                            >
                                <X className="w-6 h-6" />
                            </button>
                        </div>
                        <div className="p-6 overflow-y-auto flex-1">
                            {importError && (
                                <div className="mb-4 bg-red-50 text-red-700 p-3 rounded-md text-sm border border-red-200">
                                    {importError}
                                </div>
                            )}
                            <p className="text-sm text-slate-600 mb-6">
                                We found <strong>{importData.dataRows.length}</strong> rows. 
                                Please confirm how the CSV columns map to your event's form fields.
                            </p>

                            <div className="space-y-4">
                                {importData.headers.map((header, index) => (
                                    <div key={index} className="grid grid-cols-2 gap-4 items-center bg-slate-50 p-3 rounded-lg border border-slate-100">
                                        <div className="flex flex-col">
                                            <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">CSV Column</span>
                                            <span className="font-semibold text-slate-900 truncate" title={header}>{header || '(Empty Column Name)'}</span>
                                        </div>
                                        <div>
                                            <span className="text-xs text-slate-500 font-medium uppercase tracking-wide block mb-1">Maps To Form Field</span>
                                            <Select
                                                value={importMappings[index] || ''}
                                                onChange={(e) => setImportMappings(prev => ({ ...prev, [index]: e.target.value }))}
                                                options={[
                                                    { value: '', label: '-- Ignore this column --' },
                                                    ...formFields.map(f => ({ value: f.id, label: f.label }))
                                                ]}
                                            />
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <div className="p-6 border-t border-slate-100 bg-slate-50 shrink-0 flex justify-end gap-3">
                            <Button variant="ghost" onClick={() => setShowImportModal(false)} disabled={importing}>
                                Cancel
                            </Button>
                            <Button variant="primary" onClick={handleImportConfirm} loading={importing}>
                                Import {importData.dataRows.length} Registrations
                            </Button>
                        </div>
                    </Card>
                </div>
            )}
        </div>
    );
}
