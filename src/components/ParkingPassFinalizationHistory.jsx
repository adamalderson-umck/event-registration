import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { listParkingPassFinalizationEvents } from '../services/parkingPassFinalization';
import Button from './ui/Button';
import Card from './ui/Card';

export default function ParkingPassFinalizationHistory({ registrationId, orgId, refreshKey }) {
    const [expanded, setExpanded] = useState(false);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [entries, setEntries] = useState([]);
    const priorRefreshKey = useRef(refreshKey);

    const load = useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            setEntries(await listParkingPassFinalizationEvents(registrationId, orgId));
        } catch {
            setError('Unable to load pass history.');
        } finally {
            setLoading(false);
        }
    }, [registrationId, orgId]);

    useEffect(() => {
        if (priorRefreshKey.current === refreshKey) return;
        priorRefreshKey.current = refreshKey;
        if (expanded) void load();
    }, [expanded, load, refreshKey]);

    const toggle = () => {
        if (expanded) {
            setExpanded(false);
        } else {
            setExpanded(true);
            void load();
        }
    };

    return (
        <Card className="overflow-hidden">
            <button
                type="button"
                aria-expanded={expanded}
                onClick={toggle}
                className="flex w-full items-center gap-2 px-5 py-4 text-left text-sm font-semibold text-slate-800 hover:bg-slate-50 cursor-pointer"
            >
                {expanded
                    ? <ChevronDown className="h-4 w-4" />
                    : <ChevronRight className="h-4 w-4" />}
                Pass History
            </button>
            {expanded && (
                <div className="border-t border-slate-200 px-5 py-4">
                    {loading ? (
                        <p role="status" className="text-sm text-slate-500">Loading pass history…</p>
                    ) : error ? (
                        <div className="space-y-2">
                            <p role="alert" className="text-sm text-danger">{error}</p>
                            <Button size="sm" variant="secondary" onClick={load}>Retry</Button>
                        </div>
                    ) : entries.length === 0 ? (
                        <p className="text-sm text-slate-500">
                            No pass finalization actions recorded.
                        </p>
                    ) : (
                        <ol className="space-y-4">
                            {entries.map((entry) => (
                                <li
                                    key={entry.id}
                                    className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-100 pb-4 last:border-0 last:pb-0"
                                >
                                    <div>
                                        <p className="text-sm font-semibold text-slate-800">
                                            {entry.action === 'finalized'
                                                ? 'Pass finalized'
                                                : 'Finalization undone'}
                                        </p>
                                        <p className="text-sm text-slate-600">
                                            {entry.actor_display_name}
                                        </p>
                                    </div>
                                    <time
                                        className="text-xs text-slate-500"
                                        dateTime={entry.created_at}
                                    >
                                        {new Date(entry.created_at).toLocaleString()}
                                    </time>
                                </li>
                            ))}
                        </ol>
                    )}
                </div>
            )}
        </Card>
    );
}
