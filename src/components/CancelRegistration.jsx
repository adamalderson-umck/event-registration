import React from 'react';
import Card from './ui/Card';
import { Loader2 } from 'lucide-react';

// Stub — full implementation in Task 12
export default function CancelRegistration({ token }) {
    return (
        <Card className="max-w-lg mx-auto p-8 text-center">
            <p className="text-slate-500">Cancel Registration (Task 12)</p>
            <p className="text-xs text-slate-400 mt-2">Token: {token}</p>
        </Card>
    );
}
