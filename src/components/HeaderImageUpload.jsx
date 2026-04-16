import React, { useRef, useState, useCallback } from 'react';
import { Upload, X, AlertTriangle, Loader2, Image as ImageIcon } from 'lucide-react';
import { supabase } from '../services/supabase';
import { checkAspectRatio, MAX_IMAGE_SIZE, ALLOWED_IMAGE_TYPES } from '../constants/themePresets';
import Button from './ui/Button';

/**
 * Header image upload component with drag-and-drop, preview, and aspect ratio warning.
 *
 * @param {Object} props
 * @param {string|null} props.imageUrl - Current image URL
 * @param {string} props.orgId - Organization ID for storage path
 * @param {string} props.eventId - Event ID for storage path (use 'org-default' for org-level)
 * @param {(url: string|null) => void} props.onChange - Callback when image changes
 */
export default function HeaderImageUpload({ imageUrl, orgId, eventId, onChange }) {
    const fileInputRef = useRef(null);
    const [uploading, setUploading] = useState(false);
    const [dragOver, setDragOver] = useState(false);
    const [error, setError] = useState('');
    const [aspectWarning, setAspectWarning] = useState('');

    const validateFile = (file) => {
        if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
            return 'Please upload a JPG, PNG, WebP, or GIF image.';
        }
        if (file.size > MAX_IMAGE_SIZE) {
            const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
            return `File is ${sizeMB}MB. Maximum size is 5MB.`;
        }
        return null;
    };

    const checkImageAspect = (file) => {
        return new Promise((resolve) => {
            const img = new window.Image();
            img.onload = () => {
                const result = checkAspectRatio(img.width, img.height);
                URL.revokeObjectURL(img.src);
                resolve(result);
            };
            img.onerror = () => {
                URL.revokeObjectURL(img.src);
                resolve({ isValid: true, ratio: 0, expected: 1.78 });
            };
            img.src = URL.createObjectURL(file);
        });
    };

    const deleteExistingImage = useCallback(async () => {
        if (!imageUrl) return;

        // Extract the storage path from the public URL
        const bucketPath = imageUrl.split('/event-images/')[1];
        if (bucketPath) {
            try {
                await supabase.storage.from('event-images').remove([decodeURIComponent(bucketPath)]);
            } catch (err) {
                console.warn('Could not delete old image:', err);
            }
        }
    }, [imageUrl]);

    const uploadFile = useCallback(async (file) => {
        const validationError = validateFile(file);
        if (validationError) {
            setError(validationError);
            return;
        }

        setError('');
        setAspectWarning('');
        setUploading(true);

        try {
            // Check aspect ratio
            const aspect = await checkImageAspect(file);
            if (!aspect.isValid) {
                setAspectWarning(
                    `Image aspect ratio is ${aspect.ratio}:1 — recommended is ${aspect.expected}:1 (16:9). It will be letterboxed to fit.`
                );
            }

            // Delete any existing image first
            await deleteExistingImage();

            // Generate unique filename
            const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg';
            const filename = `${crypto.randomUUID()}.${ext}`;
            const storagePath = `${orgId}/${eventId}/${filename}`;

            const { error: uploadError } = await supabase.storage
                .from('event-images')
                .upload(storagePath, file, {
                    cacheControl: '3600',
                    upsert: false,
                });

            if (uploadError) throw uploadError;

            // Get public URL
            const { data: urlData } = supabase.storage
                .from('event-images')
                .getPublicUrl(storagePath);

            onChange(urlData.publicUrl);
        } catch (err) {
            console.error('Upload error:', err);
            setError(err.message || 'Failed to upload image. Please try again.');
        } finally {
            setUploading(false);
        }
    }, [orgId, eventId, deleteExistingImage, onChange]);

    const handleDrop = useCallback((e) => {
        e.preventDefault();
        setDragOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) uploadFile(file);
    }, [uploadFile]);

    const handleDragOver = useCallback((e) => {
        e.preventDefault();
        setDragOver(true);
    }, []);

    const handleDragLeave = useCallback((e) => {
        e.preventDefault();
        setDragOver(false);
    }, []);

    const handleFileSelect = (e) => {
        const file = e.target.files?.[0];
        if (file) uploadFile(file);
        // Reset input so the same file can be re-selected
        e.target.value = '';
    };

    const handleRemove = async () => {
        setUploading(true);
        await deleteExistingImage();
        onChange(null);
        setAspectWarning('');
        setError('');
        setUploading(false);
    };

    return (
        <div className="space-y-3">
            {imageUrl ? (
                /* Preview state */
                <div className="relative group">
                    <div className="aspect-video rounded-lg overflow-hidden bg-slate-100 border border-slate-200">
                        <img
                            src={imageUrl}
                            alt="Event header preview"
                            className="w-full h-full object-contain bg-slate-900"
                        />
                    </div>
                    <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={handleRemove}
                            disabled={uploading}
                            type="button"
                            className="bg-red-500/90 hover:bg-red-600 text-white rounded-full p-1.5"
                        >
                            <X className="w-4 h-4" />
                        </Button>
                    </div>
                </div>
            ) : (
                /* Upload zone */
                <div
                    className={`
                        relative border-2 border-dashed rounded-lg cursor-pointer
                        transition-colors duration-200 aspect-video flex flex-col items-center justify-center
                        ${dragOver
                            ? 'border-primary bg-primary/5'
                            : 'border-slate-300 hover:border-primary/50 hover:bg-slate-50'
                        }
                    `}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onClick={() => fileInputRef.current?.click()}
                >
                    {uploading ? (
                        <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    ) : (
                        <>
                            <Upload className="w-8 h-8 text-slate-400 mb-2" />
                            <p className="text-sm font-medium text-slate-600">
                                Drag & drop an image or click to browse
                            </p>
                            <p className="text-xs text-slate-400 mt-1">
                                JPG, PNG, WebP, or GIF • Max 5MB • 16:9 recommended
                            </p>
                        </>
                    )}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/gif"
                        onChange={handleFileSelect}
                        className="hidden"
                    />
                </div>
            )}

            {/* Aspect ratio warning */}
            {aspectWarning && (
                <div className="flex items-start gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>{aspectWarning}</span>
                </div>
            )}

            {/* Error message */}
            {error && (
                <p className="text-sm text-danger bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                    {error}
                </p>
            )}
        </div>
    );
}
