import React, { useEffect, useRef } from 'react';
import Button from './ui/Button';
import Card from './ui/Card';

function getEventWording(eventType) {
    if (eventType === 'parking') {
        return { subject: 'another vehicle', action: 'Register another vehicle' };
    }
    if (eventType === 'standard' || !eventType) {
        return { subject: 'another person', action: 'Register another person' };
    }
    return { subject: 'another registration', action: 'Submit another registration' };
}

function getFocusableElements(container) {
    return Array.from(container.querySelectorAll(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )).filter((element) => (
        element instanceof HTMLElement && element.getAttribute('aria-hidden') !== 'true'
    ));
}

export default function RecentRegistrationDialog({ eventType, onReturn, onContinue }) {
    const returnButtonRef = useRef(null);
    const restoreFocusRef = useRef(true);
    const wording = getEventWording(eventType);

    useEffect(() => {
        const previouslyFocusedElement = document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;

        returnButtonRef.current?.focus();

        return () => {
            if (restoreFocusRef.current && previouslyFocusedElement?.isConnected) {
                previouslyFocusedElement.focus();
            }
        };
    }, []);

    function handleContinue() {
        restoreFocusRef.current = false;
        onContinue();
    }

    function handleDialogKeyDown(event) {
        if (event.key === 'Escape') {
            onReturn();
            return;
        }
        if (event.key !== 'Tab') {
            return;
        }

        const focusableElements = getFocusableElements(event.currentTarget);
        const firstFocusableElement = focusableElements[0];
        const lastFocusableElement = focusableElements.at(-1);
        if (!firstFocusableElement || !lastFocusableElement) {
            return;
        }

        if (event.shiftKey && document.activeElement === firstFocusableElement) {
            event.preventDefault();
            lastFocusableElement.focus();
        } else if (!event.shiftKey && document.activeElement === lastFocusableElement) {
            event.preventDefault();
            firstFocusableElement.focus();
        }
    }

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
            <Card
                role="dialog"
                aria-modal="true"
                aria-labelledby="recent-registration-dialog-title"
                className="w-full max-w-lg p-6"
                onKeyDown={handleDialogKeyDown}
            >
                <h2
                    id="recent-registration-dialog-title"
                    className="text-xl font-bold text-slate-900"
                >
                    You recently registered
                </h2>
                <p className="mt-3 text-sm text-slate-600">
                    A registration using this email was submitted for this event within the last 10 minutes.
                    {' '}To correct an existing registration, please contact the church office.
                    {' '}If you are registering {wording.subject}, you may continue.
                </p>
                <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
                    <Button type="button" variant="secondary" onClick={handleContinue}>
                        {wording.action}
                    </Button>
                    <Button ref={returnButtonRef} type="button" onClick={onReturn}>
                        Return to form
                    </Button>
                </div>
            </Card>
        </div>
    );
}
