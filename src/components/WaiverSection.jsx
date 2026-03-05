import React, { lazy, Suspense } from 'react';
import { FileSignature, Loader2 } from 'lucide-react';
import Checkbox from './ui/Checkbox';
import Input from './ui/Input';
import Label from './ui/Label';
import Card from './ui/Card';

const WaiverEditor = lazy(() => import('./WaiverEditor'));

export default function WaiverSection({ waiver, onChange }) {
    const handleChange = (key, value) => {
        onChange({ ...waiver, [key]: value });
    };

    return (
        <Card className="p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <FileSignature className="w-5 h-5 text-primary" />
                Waiver / E-Sign
            </h3>
            <div className="space-y-4">
                <Checkbox
                    label="Require waiver signature"
                    checked={waiver.enabled}
                    onChange={(e) => handleChange('enabled', e.target.checked)}
                />

                {waiver.enabled && (
                    <>
                        <div>
                            <Label htmlFor="waiver-title">Waiver Title</Label>
                            <Input
                                id="waiver-title"
                                value={waiver.title}
                                onChange={(e) => handleChange('title', e.target.value)}
                                placeholder="e.g. Media Release, Liability Waiver"
                            />
                        </div>
                        <div>
                            <Label>Waiver Content</Label>
                            <Suspense fallback={
                                <div className="flex justify-center py-8 border border-slate-300 rounded-lg">
                                    <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                                </div>
                            }>
                                <WaiverEditor
                                    content={waiver.content}
                                    onChange={(html) => handleChange('content', html)}
                                />
                            </Suspense>
                        </div>
                    </>
                )}
            </div>
        </Card>
    );
}
