import React, { useRef, useEffect, useCallback } from 'react';
import SignaturePadLib from 'signature_pad';
import { Eraser } from 'lucide-react';
import Button from './ui/Button';

export default function SignaturePad({ onChange, disabled }) {
    const canvasRef = useRef(null);
    const padRef = useRef(null);

    const onChangeRef = useRef(onChange);
    useEffect(() => {
        onChangeRef.current = onChange;
    }, [onChange]);

    const resizeCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ratio = Math.max(window.devicePixelRatio || 1, 1);
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * ratio;
        canvas.height = rect.height * ratio;
        canvas.getContext('2d').scale(ratio, ratio);

        // Clear after resize since canvas content is lost
        if (padRef.current) {
            const wasEmpty = padRef.current.isEmpty();
            padRef.current.clear();
            if (!wasEmpty) {
                onChangeRef.current(null);
            }
        }
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        padRef.current = new SignaturePadLib(canvas, {
            backgroundColor: 'rgb(255, 255, 255)',
            penColor: 'rgb(15, 23, 42)', // slate-900
        });

        padRef.current.addEventListener('endStroke', () => {
            if (padRef.current.isEmpty()) {
                onChangeRef.current(null);
            } else {
                onChangeRef.current(padRef.current.toDataURL('image/png'));
            }
        });

        resizeCanvas();
        window.addEventListener('resize', resizeCanvas);

        return () => {
            window.removeEventListener('resize', resizeCanvas);
            if (padRef.current) {
                padRef.current.off();
            }
        };
    }, [resizeCanvas]);

    useEffect(() => {
        if (padRef.current) {
            disabled ? padRef.current.off() : padRef.current.on();
        }
    }, [disabled]);

    const handleClear = () => {
        if (padRef.current) {
            padRef.current.clear();
            onChange(null);
        }
    };

    return (
        <div className="space-y-2">
            <div className="relative border border-slate-300 rounded-lg overflow-hidden bg-white">
                <canvas
                    ref={canvasRef}
                    className="w-full cursor-crosshair"
                    style={{ height: '150px', touchAction: 'none' }}
                />
                {/* Signature line */}
                <div className="absolute bottom-8 left-6 right-6 border-b border-slate-300" />
                <p className="absolute bottom-2 left-6 text-xs text-slate-400">Sign above</p>
            </div>
            <div className="flex justify-end">
                <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={handleClear}
                    disabled={disabled}
                >
                    <Eraser className="w-3 h-3" /> Clear
                </Button>
            </div>
        </div>
    );
}
