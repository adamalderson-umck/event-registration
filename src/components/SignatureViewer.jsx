import React, { useState } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Download, CheckCircle2, XCircle } from 'lucide-react';
import Button from './ui/Button';

/**
 * Generates a single-page PDF for one signature record.
 * @param {object} sig - A single entry from signature_records[]
 * @param {string} waiverContent - Raw HTML content of the waiver (used for body text)
 */
async function generateSignedWaiverPdf(sig, waiverContent) {
    const pdfDoc = await PDFDocument.create();
    let page = pdfDoc.addPage([612, 792]); // US Letter
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontSize = 10;
    let y = 740;
    const leftMargin = 50;
    const maxWidth = 512;

    // Title
    page.drawText(sig.waiverTitle || 'Waiver Agreement', {
        x: leftMargin, y, font: fontBold, size: 18, color: rgb(0.06, 0.09, 0.16),
    });
    y -= 30;

    // Declined notice
    if (sig.declined) {
        page.drawText('DECLINED — Registrant explicitly declined this waiver.', {
            x: leftMargin, y, font: fontBold, size: 11, color: rgb(0.8, 0.1, 0.1),
        });
        y -= 20;
    }

    // Waiver body text (strip HTML tags for plain text)
    const plainText = (waiverContent || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const words = plainText.split(' ');
    let line = '';
    for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        const testWidth = font.widthOfTextAtSize(testLine, fontSize);
        if (testWidth > maxWidth && line) {
            page.drawText(line, { x: leftMargin, y, font, size: fontSize });
            y -= 15;
            line = word;
            if (y < 100) {
                page = pdfDoc.addPage([612, 792]);
                y = 740;
            }
        } else {
            line = testLine;
        }
    }
    if (line) {
        page.drawText(line, { x: leftMargin, y, font, size: fontSize });
        y -= 30;
    }

    // ── Signature section (only for signed records) ────────────────────────────
    if (sig.signed) {
        page.drawLine({
            start: { x: leftMargin, y: y + 5 },
            end: { x: leftMargin + maxWidth, y: y + 5 },
            color: rgb(0.8, 0.8, 0.8),
            thickness: 0.5,
        });
        y -= 10;

        if (sig.signatureMethod === 'draw' && sig.signatureData) {
            try {
                const pngBytes = Uint8Array.from(
                    atob(sig.signatureData.split(',')[1]),
                    (c) => c.charCodeAt(0)
                );
                const pngImage = await pdfDoc.embedPng(pngBytes);
                const scale = Math.min(200 / pngImage.width, 60 / pngImage.height);
                page.drawImage(pngImage, {
                    x: leftMargin,
                    y: y - 60,
                    width: pngImage.width * scale,
                    height: pngImage.height * scale,
                });
                y -= 70;
            } catch (err) {
                console.warn('Could not embed signature image:', err);
            }
        } else if (sig.signatureMethod === 'type') {
            page.drawText(sig.signerName || '', {
                x: leftMargin, y: y - 20, font, size: 22, color: rgb(0.06, 0.09, 0.16),
            });
            y -= 40;
        }
    }

    // ── Audit details ──────────────────────────────────────────────────────────
    y -= 10;
    const details = [
        `Signer: ${sig.signerName || 'N/A'}`,
        `Email: ${sig.signerEmail || 'N/A'}`,
        sig.signed
            ? `Signed At: ${sig.signedAt ? new Date(sig.signedAt).toLocaleString() : 'N/A'}`
            : `Declined At: ${sig.declinedAt ? new Date(sig.declinedAt).toLocaleString() : 'N/A'}`,
        sig.signed ? `Method: ${sig.signatureMethod === 'draw' ? 'Drawn signature' : 'Typed signature'}` : 'Status: Declined',
        `IP Address: ${sig.ipAddress || 'N/A'}`,
        `Content Hash: ${sig.waiverContentHash || 'N/A'}`,
    ];

    for (const detail of details) {
        page.drawText(detail, { x: leftMargin, y, font, size: 8, color: rgb(0.4, 0.4, 0.4) });
        y -= 12;
    }

    y -= 10;
    page.drawText('Electronically signed via Event Registration System', {
        x: leftMargin, y, font, size: 7, color: rgb(0.6, 0.6, 0.6),
    });

    return await pdfDoc.save();
}

// ── Individual waiver card ──────────────────────────────────────────────────────

function WaiverRecord({ sig, waiverContent }) {
    const [downloading, setDownloading] = useState(false);

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const pdfBytes = await generateSignedWaiverPdf(sig, waiverContent);
            const blob = new Blob([pdfBytes], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${sig.waiverTitle || 'waiver'}-${sig.signerName || 'signed'}.pdf`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (err) {
            console.error('PDF generation error:', err);
        } finally {
            setDownloading(false);
        }
    };

    if (sig.declined) {
        return (
            <div className="border border-slate-200 bg-slate-50 rounded-lg p-4 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <XCircle className="w-4 h-4 text-slate-400" />
                    <span className="text-sm font-medium text-slate-600">
                        {sig.waiverTitle || 'Waiver'} — Declined
                    </span>
                </div>
                <Button variant="secondary" size="sm" onClick={handleDownload} loading={downloading}>
                    <Download className="w-3 h-3" /> Download PDF
                </Button>
            </div>
        );
    }

    return (
        <div className="border border-green-200 bg-green-50/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="text-sm font-medium text-slate-900">
                        {sig.waiverTitle || 'Waiver'} — Signed
                    </span>
                </div>
                <Button variant="secondary" size="sm" onClick={handleDownload} loading={downloading}>
                    <Download className="w-3 h-3" /> Download PDF
                </Button>
            </div>

            {/* Signature preview */}
            <div className="bg-white border border-slate-200 rounded-lg p-3">
                {sig.signatureMethod === 'draw' && sig.signatureData ? (
                    <img
                        src={sig.signatureData}
                        alt="Signature"
                        className="max-h-16 object-contain"
                    />
                ) : (
                    <p className="text-2xl text-slate-900"
                        style={{ fontFamily: sig.signatureFont || "'Dancing Script', cursive" }}>
                        {sig.signerName}
                    </p>
                )}
            </div>

            {/* Audit details */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-500">
                <span>Signer: {sig.signerName}</span>
                <span>Email: {sig.signerEmail || 'N/A'}</span>
                <span>Date: {sig.signedAt ? new Date(sig.signedAt).toLocaleString() : 'N/A'}</span>
                <span>IP: {sig.ipAddress || 'N/A'}</span>
            </div>
        </div>
    );
}

// ── Public component ────────────────────────────────────────────────────────────

/**
 * Renders all waiver signature records for one registration.
 *
 * Props:
 *   registration {object} — must have signature_records[]
 *   event        {object} — used to look up waiverContent by waiver ID
 */
export default function SignatureViewer({ registration, event }) {
    const records = registration?.signature_records;
    if (!Array.isArray(records) || records.length === 0) return null;

    // Build a lookup from waiver ID → content for PDF generation
    const waiverContentMap = {};
    if (Array.isArray(event?.waivers)) {
        for (const w of event.waivers) {
            waiverContentMap[w.id] = w.content || '';
        }
    }

    return (
        <div className="space-y-3">
            {records.map((sig) => (
                <WaiverRecord
                    key={sig.waiverId || sig.waiverTitle}
                    sig={sig}
                    waiverContent={waiverContentMap[sig.waiverId] || ''}
                />
            ))}
        </div>
    );
}
