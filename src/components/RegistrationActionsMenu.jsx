import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

export default function RegistrationActionsMenu({ items, disabled = false }) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState({ top: 0, left: 0 });
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const itemRefs = useRef([]);
    const enabledItems = items.filter((item) => item.enabled !== false);

    useEffect(() => {
        if (!open) return undefined;

        itemRefs.current[0]?.focus();
        const closeOutside = (event) => {
            if (!rootRef.current?.contains(event.target)) setOpen(false);
        };
        document.addEventListener('pointerdown', closeOutside);
        return () => document.removeEventListener('pointerdown', closeOutside);
    }, [open]);

    const focusItem = (index) => itemRefs.current[index]?.focus();
    const toggleMenu = () => {
        if (!open) {
            const rect = triggerRef.current.getBoundingClientRect();
            setPosition({ top: rect.bottom + 4, left: Math.max(8, rect.right - 176) });
        }
        setOpen((value) => !value);
    };

    const handleMenuKeyDown = (event) => {
        const current = itemRefs.current.indexOf(document.activeElement);
        if (event.key === 'Escape') {
            event.preventDefault();
            setOpen(false);
            triggerRef.current?.focus();
        } else if (event.key === 'ArrowDown') {
            event.preventDefault();
            focusItem((current + 1 + enabledItems.length) % enabledItems.length);
        } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            focusItem((current - 1 + enabledItems.length) % enabledItems.length);
        } else if (event.key === 'Home') {
            event.preventDefault();
            focusItem(0);
        } else if (event.key === 'End') {
            event.preventDefault();
            focusItem(enabledItems.length - 1);
        }
    };

    return (
        <div ref={rootRef} className="relative inline-block">
            <button
                ref={triggerRef}
                type="button"
                disabled={disabled}
                aria-haspopup="menu"
                aria-expanded={open}
                onClick={toggleMenu}
                className="inline-flex items-center gap-1 font-medium text-primary hover:text-primary-dark disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer"
            >
                Actions <ChevronDown className="h-4 w-4" />
            </button>
            {open && (
                <div
                    role="menu"
                    aria-label="Registration actions"
                    onKeyDown={handleMenuKeyDown}
                    style={position}
                    className="fixed z-50 min-w-44 rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
                >
                    {enabledItems.map((item, index) => (
                        <button
                            key={item.label}
                            ref={(node) => { itemRefs.current[index] = node; }}
                            type="button"
                            role="menuitem"
                            tabIndex={index === 0 ? 0 : -1}
                            onClick={() => {
                                setOpen(false);
                                item.onSelect();
                            }}
                            className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50 cursor-pointer"
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
}
