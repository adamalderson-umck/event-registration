import React from 'react';
import { Check, Palette } from 'lucide-react';
import { THEME_PRESETS } from '../constants/themePresets';
import Input from './ui/Input';
import Label from './ui/Label';

/**
 * Theme color picker with curated presets and custom hex input.
 *
 * @param {Object} props
 * @param {Object|null} props.theme - Current theme value { preset, primaryColor, accentColor }
 * @param {(theme: Object) => void} props.onChange - Callback when theme changes
 */
export default function ThemePicker({ theme, onChange }) {
    const currentPreset = theme?.preset || 'default';
    const isCustom = currentPreset === 'custom';

    const handlePresetSelect = (preset) => {
        onChange({
            preset: preset.id,
            primaryColor: preset.primary,
            accentColor: preset.accent,
        });
    };

    const handleCustomToggle = () => {
        onChange({
            preset: 'custom',
            primaryColor: theme?.primaryColor || '#2563eb',
            accentColor: theme?.accentColor || '#8b5cf6',
        });
    };

    const handleCustomColorChange = (key, value) => {
        onChange({
            ...theme,
            preset: 'custom',
            [key]: value,
        });
    };

    return (
        <div className="space-y-4">
            {/* Preset grid */}
            <div className="grid grid-cols-4 gap-3">
                {THEME_PRESETS.map((preset) => {
                    const isActive = currentPreset === preset.id;
                    return (
                        <button
                            key={preset.id}
                            type="button"
                            onClick={() => handlePresetSelect(preset)}
                            className={`
                                relative flex flex-col items-center gap-1.5 p-3 rounded-lg border-2
                                transition-all duration-200 cursor-pointer
                                ${isActive
                                    ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                                    : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                                }
                            `}
                        >
                            {/* Color swatch */}
                            <div className="flex gap-1">
                                <div
                                    className="w-5 h-5 rounded-full border border-black/10"
                                    style={{ backgroundColor: preset.primary }}
                                />
                                <div
                                    className="w-5 h-5 rounded-full border border-black/10"
                                    style={{ backgroundColor: preset.accent }}
                                />
                            </div>
                            <span className="text-xs font-medium text-slate-600">{preset.name}</span>
                            {isActive && (
                                <div className="absolute top-1 right-1">
                                    <Check className="w-3.5 h-3.5 text-primary" />
                                </div>
                            )}
                        </button>
                    );
                })}

                {/* Custom option */}
                <button
                    type="button"
                    onClick={handleCustomToggle}
                    className={`
                        relative flex flex-col items-center gap-1.5 p-3 rounded-lg border-2
                        transition-all duration-200 cursor-pointer
                        ${isCustom
                            ? 'border-primary ring-2 ring-primary/20 bg-primary/5'
                            : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                        }
                    `}
                >
                    <div className="flex gap-1">
                        {isCustom ? (
                            <>
                                <div
                                    className="w-5 h-5 rounded-full border border-black/10"
                                    style={{ backgroundColor: theme?.primaryColor || '#2563eb' }}
                                />
                                <div
                                    className="w-5 h-5 rounded-full border border-black/10"
                                    style={{ backgroundColor: theme?.accentColor || '#8b5cf6' }}
                                />
                            </>
                        ) : (
                            <Palette className="w-5 h-5 text-slate-400" />
                        )}
                    </div>
                    <span className="text-xs font-medium text-slate-600">Custom</span>
                    {isCustom && (
                        <div className="absolute top-1 right-1">
                            <Check className="w-3.5 h-3.5 text-primary" />
                        </div>
                    )}
                </button>
            </div>

            {/* Custom hex inputs */}
            {isCustom && (
                <div className="grid grid-cols-2 gap-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
                    <div>
                        <Label htmlFor="custom-primary">Primary Color</Label>
                        <div className="flex gap-2 items-center">
                            <input
                                type="color"
                                id="custom-primary-picker"
                                value={theme?.primaryColor || '#2563eb'}
                                onChange={(e) => handleCustomColorChange('primaryColor', e.target.value)}
                                className="w-10 h-10 rounded cursor-pointer border border-slate-300"
                            />
                            <Input
                                id="custom-primary"
                                value={theme?.primaryColor || '#2563eb'}
                                onChange={(e) => handleCustomColorChange('primaryColor', e.target.value)}
                                placeholder="#2563eb"
                                className="flex-1 font-mono text-sm"
                            />
                        </div>
                    </div>
                    <div>
                        <Label htmlFor="custom-accent">Accent Color</Label>
                        <div className="flex gap-2 items-center">
                            <input
                                type="color"
                                id="custom-accent-picker"
                                value={theme?.accentColor || '#8b5cf6'}
                                onChange={(e) => handleCustomColorChange('accentColor', e.target.value)}
                                className="w-10 h-10 rounded cursor-pointer border border-slate-300"
                            />
                            <Input
                                id="custom-accent"
                                value={theme?.accentColor || '#8b5cf6'}
                                onChange={(e) => handleCustomColorChange('accentColor', e.target.value)}
                                placeholder="#8b5cf6"
                                className="flex-1 font-mono text-sm"
                            />
                        </div>
                    </div>
                </div>
            )}

            {/* Gradient preview */}
            <div>
                <p className="text-xs text-slate-400 mb-1.5">Preview</p>
                <div
                    className="h-10 rounded-lg"
                    style={{
                        background: `linear-gradient(to right, ${
                            isCustom
                                ? theme?.primaryColor || '#2563eb'
                                : THEME_PRESETS.find((p) => p.id === currentPreset)?.primary || '#2563eb'
                        }, ${
                            isCustom
                                ? theme?.accentColor || '#8b5cf6'
                                : THEME_PRESETS.find((p) => p.id === currentPreset)?.accent || '#8b5cf6'
                        })`,
                    }}
                />
            </div>
        </div>
    );
}
