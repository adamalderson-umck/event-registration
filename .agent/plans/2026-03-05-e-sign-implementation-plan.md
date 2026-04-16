# E-Sign / Waiver Feature Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add inline waiver/media-release e-sign capability to the event registration flow with a full legal audit trail.

**Architecture:** Org authors waiver content via TipTap rich text editor in EventEditor. Registrants view the waiver and sign (draw or type) inline during registration. Signature + audit trail stored on the registration Firestore document. Admins view signatures in RegistrationViewer and can download signed waivers as PDFs via pdf-lib.

**Tech Stack:** React 19, Vite, Firebase/Firestore, Cloud Functions v2 (Node 22), signature_pad, @tiptap/react + starter-kit + extension-underline, pdf-lib, vitest + @testing-library/react

**Design Doc:** `.agent/design/2026-03-05-e-sign-design.md`

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json` (frontend)

**Step 1: Install frontend dependencies**

```powershell
cd "e:\Coding Projects\event-registration-system"
npm install signature_pad@^5 @tiptap/react@^2 @tiptap/starter-kit@^2 @tiptap/extension-underline@^2 pdf-lib@^1
```

All packages are MIT licensed ✓

**Step 2: Verify install succeeded**

Run: `npm ls signature_pad @tiptap/react @tiptap/starter-kit @tiptap/extension-underline pdf-lib`
Expected: All 5 packages listed without errors

**Step 3: Verify existing tests still pass**

Run: `npx vitest run 2>&1 | Out-File -FilePath debug/esign-task1-tests.txt -Encoding utf8`
Expected: All existing tests pass

**Step 4: Commit**

```powershell
git add package.json package-lock.json
git commit -m "feat(esign): install signature_pad, tiptap, pdf-lib dependencies"
```

---

### Task 2: WaiverEditor Component (Admin Rich Text Editor)

**Files:**
- Create: `src/components/WaiverEditor.jsx`

**Step 1: Create the WaiverEditor component**

This component wraps TipTap for waiver content authoring. It renders a toolbar (bold, italic, underline, bullet list, ordered list, H2, H3) and an editable content area.

```jsx
import React from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import {
    Bold, Italic, Underline as UnderlineIcon,
    List, ListOrdered, Heading2, Heading3,
} from 'lucide-react';

function ToolbarButton({ onClick, isActive, children, title }) {
    return (
        <button
            type="button"
            onClick={onClick}
            title={title}
            className={`p-1.5 rounded transition-colors cursor-pointer ${
                isActive
                    ? 'bg-primary/15 text-primary'
                    : 'text-slate-400 hover:text-slate-600 hover:bg-slate-100'
            }`}
        >
            {children}
        </button>
    );
}

export default function WaiverEditor({ content, onChange }) {
    const editor = useEditor({
        extensions: [
            StarterKit.configure({
                heading: { levels: [2, 3] },
            }),
            Underline,
        ],
        content: content || '',
        onUpdate: ({ editor }) => {
            onChange(editor.getHTML());
        },
    });

    if (!editor) return null;

    return (
        <div className="border border-slate-300 rounded-lg overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-slate-200 bg-slate-50">
                <ToolbarButton
                    onClick={() => editor.chain().focus().toggleBold().run()}
                    isActive={editor.isActive('bold')}
                    title="Bold"
                >
                    <Bold className="w-4 h-4" />
                </ToolbarButton>
                <ToolbarButton
                    onClick={() => editor.chain().focus().toggleItalic().run()}
                    isActive={editor.isActive('italic')}
                    title="Italic"
                >
                    <Italic className="w-4 h-4" />
                </ToolbarButton>
                <ToolbarButton
                    onClick={() => editor.chain().focus().toggleUnderline().run()}
                    isActive={editor.isActive('underline')}
                    title="Underline"
                >
                    <UnderlineIcon className="w-4 h-4" />
                </ToolbarButton>

                <div className="w-px h-5 bg-slate-200 mx-1" />

                <ToolbarButton
                    onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
                    isActive={editor.isActive('heading', { level: 2 })}
                    title="Heading 2"
                >
                    <Heading2 className="w-4 h-4" />
                </ToolbarButton>
                <ToolbarButton
                    onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
                    isActive={editor.isActive('heading', { level: 3 })}
                    title="Heading 3"
                >
                    <Heading3 className="w-4 h-4" />
                </ToolbarButton>

                <div className="w-px h-5 bg-slate-200 mx-1" />

                <ToolbarButton
                    onClick={() => editor.chain().focus().toggleBulletList().run()}
                    isActive={editor.isActive('bulletList')}
                    title="Bullet List"
                >
                    <List className="w-4 h-4" />
                </ToolbarButton>
                <ToolbarButton
                    onClick={() => editor.chain().focus().toggleOrderedList().run()}
                    isActive={editor.isActive('orderedList')}
                    title="Numbered List"
                >
                    <ListOrdered className="w-4 h-4" />
                </ToolbarButton>
            </div>

            {/* Editor */}
            <EditorContent
                editor={editor}
                className="prose prose-sm max-w-none px-3 py-2 min-h-[150px] focus-within:ring-2 focus-within:ring-primary/50"
            />
        </div>
    );
}
```

**Step 2: Verify build compiles**

Run: `npx vite build 2>&1 | Out-File -FilePath debug/esign-task2-build.txt -Encoding utf8`
Expected: Build succeeds with no errors

**Step 3: Commit**

```powershell
git add src/components/WaiverEditor.jsx
git commit -m "feat(esign): add WaiverEditor rich text component with TipTap"
```

---

### Task 3: WaiverSection in EventEditor

**Files:**
- Create: `src/components/WaiverSection.jsx`
- Modify: `src/components/EventEditor.jsx`

**Step 1: Create the WaiverSection component**

```jsx
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
```

**Step 2: Modify EventEditor.jsx**

Add waiver state to the initial event state object (around line 24):

```js
// Add to the initial state object, after formFields:
waiver: {
    enabled: false,
    title: '',
    content: '',
},
```

Add waiver to the `fetchEvent` data mapping (around line 54, inside the `setEvent` call):

```js
waiver: {
    enabled: !!data.waiverEnabled,
    title: data.waiverTitle || '',
    content: data.waiverContent || '',
},
```

Add waiver fields to the `handleSave` eventData object (around line 125, inside `eventData`):

```js
waiverEnabled: event.waiver.enabled,
waiverTitle: event.waiver.enabled ? event.waiver.title.trim() : '',
waiverContent: event.waiver.enabled ? event.waiver.content : '',
```

Add the WaiverSection import and render it between Organizer Notifications and Form Fields (around line 349):

```jsx
import WaiverSection from './WaiverSection';

{/* Render between Notifications Card and Form Fields */}
<WaiverSection
    waiver={event.waiver}
    onChange={(waiver) => handleChange('waiver', waiver)}
/>
```

**Step 3: Verify build compiles**

Run: `npx vite build 2>&1 | Out-File -FilePath debug/esign-task3-build.txt -Encoding utf8`
Expected: Build succeeds

**Step 4: Commit**

```powershell
git add src/components/WaiverSection.jsx src/components/EventEditor.jsx
git commit -m "feat(esign): add WaiverSection to EventEditor with toggle and rich text"
```

---

### Task 4: SignaturePad Component (Draw-to-Sign)

**Files:**
- Create: `src/components/SignaturePad.jsx`

**Step 1: Create the SignaturePad component**

This wraps the `signature_pad` library with a canvas element, providing draw-to-sign with a clear button.

```jsx
import React, { useRef, useEffect, useCallback } from 'react';
import SignaturePadLib from 'signature_pad';
import { Eraser } from 'lucide-react';
import Button from './ui/Button';

export default function SignaturePad({ onChange, disabled }) {
    const canvasRef = useRef(null);
    const padRef = useRef(null);

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
            padRef.current.clear();
            onChange(null);
        }
    }, [onChange]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        padRef.current = new SignaturePadLib(canvas, {
            backgroundColor: 'rgb(255, 255, 255)',
            penColor: 'rgb(15, 23, 42)', // slate-900
        });

        padRef.current.addEventListener('endStroke', () => {
            if (padRef.current.isEmpty()) {
                onChange(null);
            } else {
                onChange(padRef.current.toDataURL('image/png'));
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
    }, [onChange, resizeCanvas]);

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
```

**Step 2: Verify build compiles**

Run: `npx vite build 2>&1 | Out-File -FilePath debug/esign-task4-build.txt -Encoding utf8`
Expected: Build succeeds

**Step 3: Commit**

```powershell
git add src/components/SignaturePad.jsx
git commit -m "feat(esign): add SignaturePad draw-to-sign component"
```

---

### Task 5: TypeToSign Component

**Files:**
- Create: `src/components/TypeToSign.jsx`

**Step 1: Add Google Font link to index.html**

Add to `<head>` in `index.html`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Dancing+Script:wght@400;700&display=swap" rel="stylesheet">
```

**Step 2: Create the TypeToSign component**

```jsx
import React from 'react';

export default function TypeToSign({ name }) {
    return (
        <div className="border border-slate-300 rounded-lg bg-white px-6 py-4 relative"
            style={{ height: '150px' }}
        >
            <div className="flex items-end h-full pb-6">
                {name ? (
                    <p
                        className="text-3xl text-slate-900 truncate w-full"
                        style={{ fontFamily: "'Dancing Script', cursive" }}
                    >
                        {name}
                    </p>
                ) : (
                    <p className="text-lg text-slate-300 italic">
                        Your name will appear here as a signature...
                    </p>
                )}
            </div>
            {/* Signature line */}
            <div className="absolute bottom-8 left-6 right-6 border-b border-slate-300" />
            <p className="absolute bottom-2 left-6 text-xs text-slate-400">Typed signature</p>
        </div>
    );
}
```

**Step 3: Verify build compiles**

Run: `npx vite build 2>&1 | Out-File -FilePath debug/esign-task5-build.txt -Encoding utf8`
Expected: Build succeeds

**Step 4: Commit**

```powershell
git add index.html src/components/TypeToSign.jsx
git commit -m "feat(esign): add TypeToSign component with Dancing Script font"
```

---

### Task 6: WaiverSignatureStep Component (Registration Form Integration)

**Files:**
- Create: `src/components/WaiverSignatureStep.jsx`

**Step 1: Create the WaiverSignatureStep component**

This is the main waiver + signature UI shown during registration. It includes the waiver text display, e-sign consent checkbox, signer name input, draw/type tab toggle, and the signature capture components.

```jsx
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
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                            activeTab === 'draw'
                                ? 'bg-primary text-white'
                                : 'bg-white text-slate-600 hover:bg-slate-50'
                        }`}
                    >
                        <Pen className="w-4 h-4" /> Draw
                    </button>
                    <button
                        type="button"
                        onClick={() => handleTabSwitch('type')}
                        className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors cursor-pointer ${
                            activeTab === 'type'
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
```

**Step 2: Verify build compiles**

Run: `npx vite build 2>&1 | Out-File -FilePath debug/esign-task6-build.txt -Encoding utf8`
Expected: Build succeeds

**Step 3: Commit**

```powershell
git add src/components/WaiverSignatureStep.jsx
git commit -m "feat(esign): add WaiverSignatureStep registration form component"
```

---

### Task 7: captureSignerIp Cloud Function

**Files:**
- Modify: `functions/index.js`

**Step 1: Add the captureSignerIp callable function**

Add the following export to `functions/index.js` (after the existing `joinDemoOrg` export, around line 50):

```js
/**
 * captureSignerIp — Callable Cloud Function
 *
 * Returns the caller's IP address for e-sign audit trail.
 * No auth required — registrants may be anonymous.
 */
exports.captureSignerIp = onCall((request) => {
    const forwarded = request.rawRequest?.headers?.["x-forwarded-for"];
    const ip = forwarded
        ? forwarded.split(",")[0].trim()
        : request.rawRequest?.ip || "unknown";

    return { ip };
});
```

**Step 2: Verify functions build**

Run: `cd "e:\Coding Projects\event-registration-system\functions" ; node -e "require('./index.js'); console.log('OK')" 2>&1 | Out-File -FilePath "../debug/esign-task7-build.txt" -Encoding utf8`
Expected: Outputs "OK" without errors

**Step 3: Commit**

```powershell
git add functions/index.js
git commit -m "feat(esign): add captureSignerIp callable Cloud Function"
```

---

### Task 8: Integrate WaiverSignatureStep into EventRegistrationForm

**Files:**
- Modify: `src/components/EventRegistrationForm.jsx`

This is the core integration task. The registration form needs to:
1. Show `WaiverSignatureStep` when `event.waiverEnabled` is true
2. Add waiver state management
3. Add waiver validation
4. Include `signatureRecord` in the registration data submitted to Firestore
5. Call `captureSignerIp` Cloud Function to get the client IP

**Step 1: Add imports**

Add at the top of `EventRegistrationForm.jsx`:

```js
import { httpsCallable } from 'firebase/functions';
import { functions } from '../services/firebase';
import WaiverSignatureStep from './WaiverSignatureStep';
```

> Note: Check if `functions` is already exported from `src/services/firebase.js`. If not, add `export const functions = getFunctions(app);` to that file along with the `import { getFunctions } from 'firebase/functions';`.

**Step 2: Add waiver state**

Add after the existing `useState` calls (around line 18):

```js
const [waiverData, setWaiverData] = useState({
    consentToESign: false,
    signerName: '',
    signatureMethod: 'draw',
    signatureData: null,
    signatureFont: null,
});
const [waiverErrors, setWaiverErrors] = useState({});
```

**Step 3: Add waiver validation to the `validate` function**

Add at the end of the existing `validate` function, before the `return`:

```js
// Waiver validation (only when waiver is enabled)
if (event?.waiverEnabled) {
    if (!waiverData.consentToESign) {
        newErrors._waiver_consent = 'consent';
        setWaiverErrors((prev) => ({
            ...prev,
            consentToESign: 'You must agree to sign electronically',
        }));
    }
    if (!waiverData.signerName?.trim()) {
        newErrors._waiver_name = 'name';
        setWaiverErrors((prev) => ({
            ...prev,
            signerName: 'Full legal name is required',
        }));
    }
    if (waiverData.signatureMethod === 'draw' && !waiverData.signatureData) {
        newErrors._waiver_sig = 'signature';
        setWaiverErrors((prev) => ({
            ...prev,
            signature: 'Please draw your signature',
        }));
    }
}
```

**Step 4: Modify handleSubmit to include signatureRecord**

Replace the `registrationData` object construction in `handleSubmit` (around line 107-114) with:

```js
const registrationData = {
    eventId,
    formData,
    status: 'pending',
    paymentStatus: event.paymentEnabled ? 'pending' : 'not_required',
    paymentMethod: null,
    createdAt: serverTimestamp(),
};

// Add signature record if waiver is enabled
if (event.waiverEnabled) {
    let ipAddress = 'unknown';
    try {
        const getIp = httpsCallable(functions, 'captureSignerIp');
        const ipResult = await getIp();
        ipAddress = ipResult.data.ip;
    } catch (err) {
        console.warn('Could not capture IP:', err);
    }

    registrationData.signatureRecord = {
        signed: true,
        signedAt: serverTimestamp(),
        signerName: waiverData.signerName.trim(),
        signerEmail: findRegistrantEmail(event.formFields, formData),
        signatureMethod: waiverData.signatureMethod,
        signatureData: waiverData.signatureMethod === 'draw'
            ? waiverData.signatureData
            : null,
        signatureFont: waiverData.signatureMethod === 'type'
            ? waiverData.signatureFont
            : null,
        waiverTitle: event.waiverTitle || '',
        waiverContentHash: event.waiverContentHash || '',
        ipAddress,
        userAgent: navigator.userAgent,
        consentToESign: true,
    };
}
```

Add the helper function before `handleSubmit`:

```js
const findRegistrantEmail = (fields, data) => {
    const emailField = (fields || []).find((f) => f.type === 'email');
    return emailField ? data[emailField.id] || '' : '';
};
```

**Step 5: Render WaiverSignatureStep in the form**

Add before the submit button (around line 239, after the `{/* Payment section placeholder */}` comment):

```jsx
{event.waiverEnabled && (
    <WaiverSignatureStep
        waiver={event}
        value={waiverData}
        onChange={(data) => {
            setWaiverData(data);
            setWaiverErrors({});
        }}
        errors={waiverErrors}
    />
)}
```

**Step 6: Add handleReset cleanup**

In `handleReset`, add waiver state reset:

```js
setWaiverData({
    consentToESign: false,
    signerName: '',
    signatureMethod: 'draw',
    signatureData: null,
    signatureFont: null,
});
setWaiverErrors({});
```

**Step 7: Verify build compiles**

Run: `npx vite build 2>&1 | Out-File -FilePath debug/esign-task8-build.txt -Encoding utf8`
Expected: Build succeeds

**Step 8: Verify existing tests still pass**

Run: `npx vitest run 2>&1 | Out-File -FilePath debug/esign-task8-tests.txt -Encoding utf8`
Expected: All tests pass

**Step 9: Commit**

```powershell
git add src/components/EventRegistrationForm.jsx src/services/firebase.js
git commit -m "feat(esign): integrate waiver signing into registration form with audit trail"
```

---

### Task 9: SignatureViewer + PDF Download in RegistrationViewer

**Files:**
- Create: `src/components/SignatureViewer.jsx`
- Modify: `src/components/RegistrationViewer.jsx`

**Step 1: Create the SignatureViewer component**

```jsx
import React, { useState } from 'react';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { Download, CheckCircle2, Loader2 } from 'lucide-react';
import Button from './ui/Button';

async function generateSignedWaiverPdf(registration, event) {
    const sig = registration.signatureRecord;
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // US Letter
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
                const newPage = pdfDoc.addPage([612, 792]);
                y = 740;
                // Continue on new page (simplified — use same page ref pattern)
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
```

**Step 2: Add SignatureViewer to RegistrationViewer**

In `src/components/RegistrationViewer.jsx`, import and render the SignatureViewer for each registration that has a `signatureRecord`:

```jsx
import SignatureViewer from './SignatureViewer';

{/* Inside the registration detail/expand area, render: */}
<SignatureViewer registration={reg} event={event} />
```

The exact placement will be in the registration detail row, after the existing form data display.

**Step 3: Verify build compiles**

Run: `npx vite build 2>&1 | Out-File -FilePath debug/esign-task9-build.txt -Encoding utf8`
Expected: Build succeeds

**Step 4: Commit**

```powershell
git add src/components/SignatureViewer.jsx src/components/RegistrationViewer.jsx
git commit -m "feat(esign): add SignatureViewer with PDF download in RegistrationViewer"
```

---

### Task 10: SHA-256 Waiver Content Hashing

**Files:**
- Create: `src/utils/hashContent.js`
- Modify: `src/components/EventEditor.jsx` (handleSave)
- Modify: `src/components/EventRegistrationForm.jsx` (handleSubmit, to verify hash availability)

**Step 1: Create the hash utility**

```js
/**
 * Compute SHA-256 hash of a string using the Web Crypto API.
 * Returns a hex-encoded hash string prefixed with "sha256:".
 */
export async function sha256(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
    return `sha256:${hashHex}`;
}
```

**Step 2: Integrate into EventEditor.jsx's handleSave**

Import and call `sha256` on `waiverContent` when saving:

```js
import { sha256 } from '../utils/hashContent';

// Inside handleSave, when building eventData:
waiverContentHash: event.waiver.enabled
    ? await sha256(event.waiver.content)
    : '',
```

**Step 3: Verify build compiles**

Run: `npx vite build 2>&1 | Out-File -FilePath debug/esign-task10-build.txt -Encoding utf8`
Expected: Build succeeds

**Step 4: Write unit test for sha256**

Create `src/utils/__tests__/hashContent.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { sha256 } from '../hashContent';

describe('sha256', () => {
    it('returns a sha256-prefixed hex hash', async () => {
        const result = await sha256('hello world');
        expect(result).toMatch(/^sha256:[a-f0-9]{64}$/);
    });

    it('produces consistent hashes', async () => {
        const a = await sha256('test content');
        const b = await sha256('test content');
        expect(a).toBe(b);
    });

    it('produces different hashes for different content', async () => {
        const a = await sha256('content A');
        const b = await sha256('content B');
        expect(a).not.toBe(b);
    });
});
```

**Step 5: Run tests**

Run: `npx vitest run 2>&1 | Out-File -FilePath debug/esign-task10-tests.txt -Encoding utf8`
Expected: All tests pass, including the new sha256 tests

**Step 6: Commit**

```powershell
git add src/utils/hashContent.js src/utils/__tests__/hashContent.test.js src/components/EventEditor.jsx
git commit -m "feat(esign): add SHA-256 waiver content hashing with tests"
```

---

### Task 11: TipTap Editor CSS Styles

**Files:**
- Modify: `src/index.css`

**Step 1: Add TipTap prose styles**

TipTap's `EditorContent` renders as a `div[contenteditable]`. Add minimal styles to `src/index.css` so the editor content area looks correct:

```css
/* TipTap Editor Styles */
.tiptap.ProseMirror {
    outline: none;
    min-height: 120px;
}

.tiptap.ProseMirror p {
    margin: 0.25em 0;
}

.tiptap.ProseMirror h2 {
    font-size: 1.25rem;
    font-weight: 700;
    margin: 0.5em 0 0.25em;
}

.tiptap.ProseMirror h3 {
    font-size: 1.1rem;
    font-weight: 600;
    margin: 0.5em 0 0.25em;
}

.tiptap.ProseMirror ul,
.tiptap.ProseMirror ol {
    padding-left: 1.5rem;
    margin: 0.25em 0;
}

.tiptap.ProseMirror li {
    margin: 0.125em 0;
}

/* Waiver content display in registration form */
.prose h2 { font-size: 1.25rem; font-weight: 700; margin: 0.5em 0 0.25em; }
.prose h3 { font-size: 1.1rem; font-weight: 600; margin: 0.5em 0 0.25em; }
.prose ul, .prose ol { padding-left: 1.5rem; margin: 0.25em 0; }
.prose li { margin: 0.125em 0; }
.prose p { margin: 0.25em 0; }
```

**Step 2: Verify build compiles**

Run: `npx vite build 2>&1 | Out-File -FilePath debug/esign-task11-build.txt -Encoding utf8`
Expected: Build succeeds

**Step 3: Commit**

```powershell
git add src/index.css
git commit -m "feat(esign): add TipTap editor and prose display CSS styles"
```

---

### Task 12: Firebase Services Export Fix

**Files:**
- Modify: `src/services/firebase.js`

**Step 1: Ensure `functions` is exported from firebase services**

Check if `getFunctions` and `functions` are already exported. If not, add:

```js
import { getFunctions } from 'firebase/functions';

// After app initialization
export const functions = getFunctions(app);
```

This is needed by `EventRegistrationForm.jsx` to call `captureSignerIp`.

**Step 2: Verify build compiles**

Run: `npx vite build 2>&1 | Out-File -FilePath debug/esign-task12-build.txt -Encoding utf8`
Expected: Build succeeds

**Step 3: Commit**

```powershell
git add src/services/firebase.js
git commit -m "feat(esign): export Firebase Functions from services"
```

---

## Verification Plan

### Automated Tests

1. **Existing tests pass:** Run `npx vitest run` — all existing `DynamicField.test.jsx` tests must still pass.
2. **SHA-256 hash tests:** Run `npx vitest run src/utils/__tests__/hashContent.test.js` — 3 new tests pass.
3. **Build check:** Run `npx vite build` — full production build with no errors.

### Manual Verification (Browser Testing)

These should be tested by running `npm run dev` and opening the app in a browser:

**Admin Side (Event Editor):**
1. Navigate to an org → Edit an existing event (or create new)
2. Verify the "Waiver / E-Sign" card appears between Notifications and Form Fields
3. Verify the toggle defaults to OFF
4. Toggle it ON → verify the title field and rich text editor appear
5. Type a waiver title (e.g., "Media Release")
6. Type waiver content using the toolbar (bold, lists, headings)
7. Save the event → reload → verify waiver data persisted

**Registrant Side (Registration Form):**
1. Open a public registration form for the event with waiver enabled
2. Verify the waiver section appears after form fields, before submit
3. Verify waiver text is displayed in a scrollable container
4. Verify the submit button is blocked until the waiver is signed
5. Check the e-sign consent checkbox
6. Type a full name
7. Test draw-to-sign: draw a signature on the canvas, click Clear, draw again
8. Test type-to-sign: switch to Type tab, verify the cursive name preview
9. Submit the registration

**Admin Side (Registration Viewer):**
1. Go to the event's registrations in the admin dashboard
2. Find the registration you just submitted
3. Verify the SignatureViewer shows: signature image (or typed), signer name, date, IP
4. Click "Download PDF" → verify a PDF downloads with waiver text + signature + audit trail

**Event Without Waiver:**
1. Create/edit an event with the waiver toggle OFF
2. Submit a registration → verify no waiver section appears, form works as before
