import React from 'react';
import Button from './ui/Button';

// Stub — full implementation in Task 9
export default function RegistrationViewer({ orgId, eventId, event, onBack }) {
    return (
        <div>
            <Button variant="ghost" onClick={onBack}>← Back</Button>
            <p className="mt-4 text-slate-500">Registration Viewer (Task 9)</p>
        </div>
    );
}
