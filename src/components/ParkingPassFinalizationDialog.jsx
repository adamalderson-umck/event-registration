import React, { useEffect, useRef } from 'react';
import Button from './ui/Button';
import Card from './ui/Card';

const content = {
    'post-print': {
        title: 'Finalize printed parking pass?',
        message: 'Was this parking pass handed to the registrant?',
        confirm: 'Finalize',
        close: 'Not yet',
    },
    finalize: {
        title: 'Finalize parking pass?',
        message: 'Confirm that this physical parking pass was handed to the registrant.',
        confirm: 'Finalize',
        close: 'Not yet',
    },
    undo: {
        title: 'Undo parking pass finalization?',
        message: 'This will reopen this pass for printing and finalization. The earlier action will remain in Pass History.',
        confirm: 'Undo Finalization',
        close: 'Keep Finalized',
    },
};

const getFocusableElements = (container) => Array.from(container.querySelectorAll(
    'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
));

export default function ParkingPassFinalizationDialog({
    registration,
    mode,
    onConfirm,
    onClose,
    saving = false,
    error = '',
}) {
    const titleRef = useRef(null);
    const copy = content[mode];
    const formData = registration?.form_data || {};
    const identity = [formData.system_first_name, formData.system_last_name]
        .filter(Boolean)
        .join(' ');
    const plate = formData.parking_license_plate;

    useEffect(() => {
        const previous = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        titleRef.current?.focus();
        return () => {
            if (previous?.isConnected) previous.focus();
        };
    }, []);

    const handleKeyDown = (event) => {
        if (event.key === 'Escape') {
            if (!saving) onClose();
            return;
        }
        if (event.key !== 'Tab') return;

        const elements = getFocusableElements(event.currentTarget);
        const first = elements[0];
        const last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <Card
                role="dialog"
                aria-modal="true"
                aria-labelledby="parking-finalization-title"
                onKeyDown={handleKeyDown}
                className="w-full max-w-md p-6"
            >
                <h2
                    ref={titleRef}
                    id="parking-finalization-title"
                    tabIndex="-1"
                    className="text-xl font-bold text-slate-900"
                >
                    {copy.title}
                </h2>
                <p className="mt-3 text-sm text-slate-700">{copy.message}</p>
                {(identity || plate) && (
                    <p className="mt-2 text-sm font-semibold text-slate-900">
                        {[identity, plate].filter(Boolean).join(' — ')}
                    </p>
                )}
                {error && <p role="alert" className="mt-4 text-sm text-danger">{error}</p>}
                <div className="mt-6 flex justify-end gap-3">
                    <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
                        {copy.close}
                    </Button>
                    <Button
                        type="button"
                        variant={mode === 'undo' ? 'danger' : 'primary'}
                        onClick={onConfirm}
                        loading={saving}
                    >
                        {copy.confirm}
                    </Button>
                </div>
            </Card>
        </div>
    );
}
