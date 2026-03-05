import React, { useState, lazy, Suspense } from 'react';
import { FileSignature, Pen, Type, Loader2 } from 'lucide-react';
import Checkbox from './ui/Checkbox';
import Input from './ui/Input';
import Label from './ui/Label';
import TypeToSign from './TypeToSign';

const SignaturePad = lazy(() => import('./SignaturePad'));

export default function WaiverSignatureStep({ waiver, value, onChange, errors }) {
    const [activeTab, setActiveTab] = useState(value?.signatureMethod || 'draw');

    const handleChange = (key, val) => {
        const updated = { ...value, [key]: val };

        // Clear draw data when switching to type, and vice versa
        if (key === 'signatureMethod') {
            if (val === 'draw') {
                updated.signatureFont = null;
            } else {
                updated.signatureData = null;
                updated.signatureFont = "'Dancing Script', cursive";
            }
        }

        onChange(updated);
    };

    const handleTabSwitch = (tab) => {
        setActiveTab(tab);
        handleChange('signatureMethod', tab);
    };

    return (
        <div className="space-y-4 border border-slate-200 rounded-xl p-5 bg-slate-50/50">
            {/* Header */}
            <div className="flex items-center gap-2">
                <FileSignature className="w-5 h-5 text-primary" />
                <h3 className="text-base font-semibold text-slate-900">
                    {waiver.waiverTitle || 'Waiver Agreement'}
                </h3>
            </div>

            {/* Waiver Text (scrollable) */}
            <div
                className="bg-white border border-slate-200 rounded-lg p-4 max-h-72 overflow-y-auto prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{ __html: waiver.waiverContent }}
            />

            {/* E-Sign Consent */}
            <div>
                <Checkbox
                    label="I agree to sign this document electronically"
                    checked={!!value?.consentToESign}
                    onChange={(e) => handleChange('consentToESign', e.target.checked)}
                />
                {errors?.consentToESign && (
                    <p className="text-xs text-danger mt-1">{errors.consentToESign}</p>
                )}
            </div>

            {/* Signer Name */}
            <div>
                <Label htmlFor="signer-name" required>Full Legal Name</Label>
                <Input
                    id="signer-name"
                    value={value?.signerName || ''}
                    onChange={(e) => handleChange('signerName', e.target.value)}
                    placeholder="Enter your full legal name"
                    error={errors?.signerName}
                    disabled={!value?.consentToESign}
                />
            </div>

            {/* Draw / Type Toggle */}
            <div>
                <Label>Signature</Label>
                <div className="flex border border-slate-300 rounded-lg overflow-hidden mb-3">
                    <button
                        type="button"
                        onClick={() => handleTabSwitch('draw')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${activeTab === 'draw'
                                ? 'bg-primary text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                    >
                        <Pen className="w-4 h-4" /> Draw
                    </button>
                    <button
                        type="button"
                        onClick={() => handleTabSwitch('type')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${activeTab === 'type'
                                ? 'bg-primary text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-50'
                            }`}
                    >
                        <Type className="w-4 h-4" /> Type
                    </button>
                </div>

                {activeTab === 'draw' ? (
                    <Suspense fallback={
                        <div className="flex justify-center py-12 border border-slate-300 rounded-lg">
                            <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                        </div>
                    }>
                        <SignaturePad
                            onChange={(data) => handleChange('signatureData', data)}
                            disabled={!value?.consentToESign}
                        />
                    </Suspense>
                ) : (
                    <TypeToSign name={value?.signerName || ''} />
                )}

                {errors?.signature && (
                    <p className="text-xs text-danger mt-1">{errors.signature}</p>
                )}
            </div>

            {/* Timestamp */}
            <p className="text-xs text-slate-400 text-right">
                {value?.consentToESign
                    ? `Signing at: ${new Date().toLocaleString()}`
                    : 'Review and accept the agreement above to sign'}
            </p>
        </div>
    );
}
