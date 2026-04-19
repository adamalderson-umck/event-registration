import React, { useState, useEffect, useRef } from 'react';
import QRCode from 'qrcode';
import { Copy, Check, X } from 'lucide-react';
import Button from './ui/Button';
import Card from './ui/Card';

export default function ShareEventModal({ event, orgId, onClose }) {
  const [copied, setCopied] = useState(false);
  const canvasRef = useRef(null);

  // Build the public registration URL
  const baseUrl = window.location.origin;
  const eventParam = event.slug || event.id;
  const eventUrl = `${baseUrl}/?org=${orgId}&event=${eventParam}`;

  useEffect(() => {
    if (canvasRef.current) {
      QRCode.toCanvas(canvasRef.current, eventUrl, {
        width: 200,
        margin: 2,
        color: { dark: '#1e293b', light: '#ffffff' },
      });
    }
  }, [eventUrl]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(eventUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback for non-HTTPS contexts
      const input = document.createElement('input');
      input.value = eventUrl;
      document.body.appendChild(input);
      input.select();
      document.execCommand('copy');
      document.body.removeChild(input);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="p-6 max-w-sm w-full relative">
        <button
          onClick={onClose}
          className="absolute top-3 right-3 text-slate-400 hover:text-slate-600 cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <h3 className="text-lg font-bold text-slate-900 mb-1">Share Event</h3>
        <p className="text-sm text-slate-500 mb-4">{event.title}</p>

        <div className="flex justify-center mb-4">
          <canvas ref={canvasRef} />
        </div>

        <div className="flex gap-2">
          <input
            readOnly
            value={eventUrl}
            className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm text-slate-700 bg-slate-50 truncate"
          />
          <Button size="sm" onClick={handleCopy}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </Card>
    </div>
  );
}
