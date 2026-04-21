/**
 * WaiverSection — admin editor for a list of independent waivers.
 *
 * Props:
 *   waivers  {Array<{id, title, content, contentHash, required, order}>}
 *   onChange {function(waivers[])} — called with the full updated array
 */
import React, { lazy, Suspense } from 'react';
import { FileSignature, GripVertical, Loader2, Plus, Trash2 } from 'lucide-react';
import {
    DndContext,
    closestCenter,
    PointerSensor,
    KeyboardSensor,
    useSensor,
    useSensors,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import Checkbox from './ui/Checkbox';
import Input from './ui/Input';
import Label from './ui/Label';
import Card from './ui/Card';
import Button from './ui/Button';

const WaiverEditor = lazy(() => import('./WaiverEditor'));

// ── Sortable card ──────────────────────────────────────────────────────────────

function SortableWaiverCard({ waiver, onChange, onDelete }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
    } = useSortable({ id: waiver.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
    };

    return (
        <div ref={setNodeRef} style={style} className="border border-slate-200 rounded-lg bg-white p-4 space-y-3">
            <div className="flex items-start gap-2">
                {/* Drag handle */}
                <button
                    type="button"
                    {...attributes}
                    {...listeners}
                    className="mt-1 text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing"
                    aria-label="Drag to reorder"
                >
                    <GripVertical className="w-4 h-4" />
                </button>

                <div className="flex-1 space-y-3">
                    {/* Title input */}
                    <div>
                        <Label htmlFor={`waiver-title-${waiver.id}`}>Waiver Title</Label>
                        <Input
                            id={`waiver-title-${waiver.id}`}
                            value={waiver.title}
                            onChange={(e) => onChange({ ...waiver, title: e.target.value })}
                            placeholder="e.g. Liability Waiver & Hold Harmless"
                        />
                    </div>

                    {/* Required toggle */}
                    <Checkbox
                        label="Required (blocks form submission if not signed)"
                        checked={!!waiver.required}
                        onChange={(e) => onChange({ ...waiver, required: e.target.checked })}
                    />

                    {/* Rich-text content editor */}
                    <div>
                        <Label>Waiver Content</Label>
                        <Suspense fallback={
                            <div className="flex justify-center py-8 border border-slate-300 rounded-lg">
                                <Loader2 className="w-5 h-5 animate-spin text-slate-400" />
                            </div>
                        }>
                            <WaiverEditor
                                content={waiver.content}
                                onChange={(html) => onChange({ ...waiver, content: html })}
                            />
                        </Suspense>
                    </div>
                </div>

                {/* Delete button */}
                <button
                    type="button"
                    onClick={onDelete}
                    aria-label="Delete waiver"
                    className="text-slate-300 hover:text-red-500 transition-colors mt-1 cursor-pointer"
                >
                    <Trash2 className="w-4 h-4" />
                </button>
            </div>
        </div>
    );
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function WaiverSection({ waivers = [], onChange }) {
    const sensors = useSensors(
        useSensor(PointerSensor),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
    );

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;
        const oldIndex = waivers.findIndex((w) => w.id === active.id);
        const newIndex = waivers.findIndex((w) => w.id === over.id);
        onChange(arrayMove(waivers, oldIndex, newIndex).map((w, i) => ({ ...w, order: i })));
    };

    const handleAdd = () => {
        const newWaiver = {
            id: `w_${Date.now()}`,
            title: '',
            content: '',
            contentHash: '',
            required: true,
            order: waivers.length,
        };
        onChange([...waivers, newWaiver]);
    };

    const handleChange = (id, updated) => {
        onChange(waivers.map((w) => (w.id === id ? updated : w)));
    };

    const handleDelete = (id) => {
        onChange(waivers.filter((w) => w.id !== id).map((w, i) => ({ ...w, order: i })));
    };

    return (
        <Card className="p-6">
            <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <FileSignature className="w-5 h-5 text-primary" />
                Waivers / E-Sign
            </h3>

            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={waivers.map((w) => w.id)} strategy={verticalListSortingStrategy}>
                    <div className="space-y-3 mb-4">
                        {waivers.map((waiver) => (
                            <SortableWaiverCard
                                key={waiver.id}
                                waiver={waiver}
                                onChange={(updated) => handleChange(waiver.id, updated)}
                                onDelete={() => handleDelete(waiver.id)}
                            />
                        ))}
                    </div>
                </SortableContext>
            </DndContext>

            {waivers.length === 0 && (
                <p className="text-sm text-slate-400 text-center py-4 mb-2">
                    No waivers configured. Click "Add Waiver" to require e-signatures from registrants.
                </p>
            )}

            <Button type="button" variant="secondary" onClick={handleAdd} className="w-full">
                <Plus className="w-4 h-4" /> Add Waiver
            </Button>
        </Card>
    );
}
