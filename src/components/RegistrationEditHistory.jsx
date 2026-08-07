import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { listRegistrationAnswerEdits } from '../services/registrationAnswerEdits';
import Button from './ui/Button';
import Card from './ui/Card';

const formatAuditValue = (value) => {
    if (value === null || value === undefined || value === '') return '—';
    if (Array.isArray(value)) return value.join(', ');
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
};

export default function RegistrationEditHistory({
    registrationId,
    orgId,
    refreshKey,
}) {
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [entries, setEntries] = useState([]);
    const priorRefreshKey = useRef(refreshKey);

    const loadHistory = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setEntries(await listRegistrationAnswerEdits(registrationId, orgId));
        } catch {
            setError('Unable to load edit history.');
        } finally {
            setLoading(false);
        }
    }, [registrationId, orgId]);

    useEffect(() => {
        if (priorRefreshKey.current === refreshKey) return;
        priorRefreshKey.current = refreshKey;
        if (expanded) void loadHistory();
    }, [expanded, loadHistory, refreshKey]);

    const handleToggle = () => {
        if (expanded) {
            setExpanded(false);
            return;
        }
        setExpanded(true);
        void loadHistory();
    };

    return (
        <Card className="overflow-hidden">
            <button
                type="button"
                aria-expanded={expanded}
                onClick={handleToggle}
                className="flex w-full items-center gap-2 px-5 py-4 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
                {expanded
                    ? <ChevronDown className="h-4 w-4" />
                    : <ChevronRight className="h-4 w-4" />}
                Edit History
            </button>

            {expanded && (
                <div className="border-t border-slate-200 px-5 py-4">
                    {loading ? (
                        <p role="status" className="text-sm text-slate-500">
                            Loading edit history…
                        </p>
                    ) : error ? (
                        <div className="space-y-2">
                            <p role="alert" className="text-sm text-danger">{error}</p>
                            <Button type="button" size="sm" variant="secondary" onClick={loadHistory}>
                                Retry
                            </Button>
                        </div>
                    ) : entries.length === 0 ? (
                        <p role="status" className="text-sm text-slate-500">
                            No answer edits recorded.
                        </p>
                    ) : (
                        <ol className="space-y-5">
                            {entries.map((entry) => (
                                <li key={entry.id} className="border-b border-slate-100 pb-5 last:border-0 last:pb-0">
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                        <p className="text-sm font-semibold text-slate-800">
                                            {entry.editor_display_name || entry.editor_user_id}
                                        </p>
                                        <time className="text-xs text-slate-500" dateTime={entry.created_at}>
                                            {new Date(entry.created_at).toLocaleString()}
                                        </time>
                                    </div>
                                    <ul className="mt-3 space-y-3">
                                        {(Array.isArray(entry.changes) ? entry.changes : []).map((change) => (
                                            <li key={change.fieldId} className="rounded-lg bg-slate-50 p-3">
                                                <p className="text-sm font-medium text-slate-800">
                                                    {change.fieldLabel || change.fieldId}
                                                </p>
                                                <dl className="mt-2 grid grid-cols-2 gap-3 text-sm">
                                                    <div>
                                                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                                            Before
                                                        </dt>
                                                        <dd className="mt-1 text-slate-700">
                                                            {formatAuditValue(change.before)}
                                                        </dd>
                                                    </div>
                                                    <div>
                                                        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                                                            After
                                                        </dt>
                                                        <dd className="mt-1 text-slate-700">
                                                            {formatAuditValue(change.after)}
                                                        </dd>
                                                    </div>
                                                </dl>
                                            </li>
                                        ))}
                                    </ul>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            )}
        </Card>
    );
}
