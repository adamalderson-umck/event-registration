import React from 'react';
import Button from './ui/Button';

// Stub — full implementation in Task 8
export default function EventEditor({ orgId, eventId, onBack }) {
    return (
        <div>
            <Button variant="ghost" onClick={onBack}>← Back</Button>
            <p className="mt-4 text-slate-500">Event Editor (Task 8)</p>
        </div>
    );
}
