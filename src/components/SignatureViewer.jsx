import React, { useState } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Download, CheckCircle2 } from 'lucide-react';
import Button from './ui/Button';

async function generateSignedWaiverPdf(registration, event) {
    const sig = registration.signatureRecord;
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

    // Waiver content (strip HTML tags for plain text)
    const plainText = (event.waiverContent || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    // Word-wrap waiver text
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

    // Signature section
    page.drawLine({
        start: { x: leftMargin, y: y + 5 },
        end: { x: leftMargin + maxWidth, y: y + 5 },
        color: rgb(0.8, 0.8, 0.8),
        thickness: 0.5,
    });
    y -= 10;

    // Embed signature image if draw method
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

    // Signer details
    y -= 10;
    const details = [
        `Signer: ${sig.signerName}`,
        `Email: ${sig.signerEmail || 'N/A'}`,
        `Date: ${sig.signedAt?.toDate?.()
            ? sig.signedAt.toDate().toLocaleString()
            : 'N/A'}`,
        `Method: ${sig.signatureMethod === 'draw' ? 'Drawn signature' : 'Typed signature'}`,
        `IP Address: ${sig.ipAddress || 'N/A'}`,
        `Content Hash: ${sig.waiverContentHash || 'N/A'}`,
    ];

    for (const detail of details) {
        page.drawText(detail, { x: leftMargin, y, font, size: 8, color: rgb(0.4, 0.4, 0.4) });
        y -= 12;
    }

    // Footer
    y -= 10;
    page.drawText('Electronically signed via Event Registration System', {
        x: leftMargin, y, font, size: 7, color: rgb(0.6, 0.6, 0.6),
    });

    return await pdfDoc.save();
}

export default function SignatureViewer({ registration, event }) {
    const [downloading, setDownloading] = useState(false);
    const sig = registration.signatureRecord;

    if (!sig?.signed) return null;

    const handleDownload = async () => {
        setDownloading(true);
        try {
            const pdfBytes = await generateSignedWaiverPdf(registration, event);
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

    return (
        <div className="border border-green-200 bg-green-50/50 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-success" />
                    <span className="text-sm font-medium text-slate-900">
                        {sig.waiverTitle || 'Waiver'} — Signed
                    </span>
                </div>
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={handleDownload}
                    loading={downloading}
                >
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
                <span>
                    Date: {sig.signedAt?.toDate?.()
                        ? sig.signedAt.toDate().toLocaleString()
                        : 'N/A'}
                </span>
                <span>IP: {sig.ipAddress || 'N/A'}</span>
            </div>
        </div>
    );
}
