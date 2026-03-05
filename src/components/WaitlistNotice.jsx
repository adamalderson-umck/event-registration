import React from 'react';
import { Clock, Users } from 'lucide-react';

export default function WaitlistNotice({ waitlistCount }) {
    return (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-6">
            <div className="flex items-start gap-3">
                <Clock className="w-5 h-5 text-amber-600 mt-0.5 shrink-0" />
                <div>
                    <p className="text-sm font-semibold text-amber-800">This event is full</p>
                    <p className="text-sm text-amber-700 mt-0.5">
                        You will be placed on the waitlist. We'll notify you by email if a spot opens up.
                    </p>
                    {waitlistCount > 0 && (
                        <p className="text-xs text-amber-600 mt-1 flex items-center gap-1">
                            <Users className="w-3 h-3" />
                            {waitlistCount} {waitlistCount === 1 ? 'person' : 'people'} currently on waitlist
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
