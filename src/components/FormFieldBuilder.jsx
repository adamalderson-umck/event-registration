import React, { useState } from 'react';
import {
    DndContext,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
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
import {
    GripVertical, Plus, Trash2, Settings2,
    User, MapPin, Phone, LayoutTemplate
} from 'lucide-react';
import { templateGroups, fieldTypeOptions } from '../config/fieldTemplates';
import Button from './ui/Button';
import Card from './ui/Card';
import FieldConfigPanel from './FieldConfigPanel';

let fieldCounter = 0;
const newFieldId = () => `field_${Date.now()}_${++fieldCounter}`;

function SortableField({ field, isSelected, onSelect, onRemove }) {
    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: field.id });

    const style = {
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.5 : 1,
    };

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={`
        flex items-center gap-2 p-3 rounded-lg border transition-all
        ${isSelected
                    ? 'border-primary bg-primary/5 shadow-sm'
                    : 'border-slate-200 bg-white hover:border-slate-300'
                }
      `}
        >
            <button
                className="text-slate-300 hover:text-slate-500 cursor-grab active:cursor-grabbing shrink-0"
                {...attributes}
                {...listeners}
            >
                <GripVertical className="w-4 h-4" />
            </button>

            <div
                className="flex-1 min-w-0 cursor-pointer"
                onClick={() => onSelect(field)}
            >
                <p className="text-sm font-medium text-slate-800 truncate">
                    {field.label || 'Untitled Field'}
                    {field.required && <span className="text-danger ml-1">*</span>}
                </p>
                <p className="text-xs text-slate-400">
                    {fieldTypeOptions.find((t) => t.value === field.type)?.label || field.type}
                </p>
            </div>

            <button
                onClick={(e) => { e.stopPropagation(); onRemove(field.id); }}
                className="text-slate-300 hover:text-danger shrink-0 cursor-pointer"
            >
                <Trash2 className="w-4 h-4" />
            </button>
        </div>
    );
}

export default function FormFieldBuilder({ fields, onChange }) {
    const [selectedField, setSelectedField] = useState(null);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragEnd = (event) => {
        const { active, over } = event;
        if (!over || active.id === over.id) return;

        const oldIndex = fields.findIndex((f) => f.id === active.id);
        const newIndex = fields.findIndex((f) => f.id === over.id);
        onChange(arrayMove(fields, oldIndex, newIndex));
    };

    const addField = () => {
        const newField = {
            id: newFieldId(),
            type: 'text',
            label: 'New Field',
            required: false,
            placeholder: '',
        };
        onChange([...fields, newField]);
        setSelectedField(newField);
    };

    const addTemplate = (template) => {
        const newFields = template.fields();
        onChange([...fields, ...newFields]);
    };

    const removeField = (fieldId) => {
        onChange(fields.filter((f) => f.id !== fieldId));
        if (selectedField?.id === fieldId) setSelectedField(null);
    };

    const updateField = (updated) => {
        onChange(fields.map((f) => (f.id === updated.id ? updated : f)));
        setSelectedField(updated);
    };

    const templateIcons = { User, MapPin, Phone };

    return (
        <div className="flex gap-0 border border-slate-200 rounded-xl overflow-hidden bg-white">
            {/* Left: Field List */}
            <div className="flex-1 p-5">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold text-slate-700 uppercase tracking-wide">Form Fields</h3>
                    <Button variant="secondary" size="sm" onClick={addField} type="button">
                        <Plus className="w-3 h-3" /> Add Field
                    </Button>
                </div>

                {/* Template Group Buttons */}
                <div className="flex flex-wrap gap-2 mb-4">
                    {templateGroups.map((tmpl) => {
                        const Icon = templateIcons[tmpl.icon] || LayoutTemplate;
                        return (
                            <button
                                key={tmpl.name}
                                type="button"
                                onClick={() => addTemplate(tmpl)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium
                  bg-slate-100 hover:bg-primary/10 hover:text-primary
                  text-slate-600 rounded-lg transition-colors cursor-pointer"
                                title={tmpl.description}
                            >
                                <Icon className="w-3 h-3" />
                                + {tmpl.name}
                            </button>
                        );
                    })}
                </div>

                {/* Sortable Field List */}
                {fields.length === 0 ? (
                    <div className="text-center py-12 border-2 border-dashed border-slate-200 rounded-lg">
                        <Settings2 className="w-10 h-10 text-slate-200 mx-auto mb-3" />
                        <p className="text-sm text-slate-400">No fields yet</p>
                        <p className="text-xs text-slate-300">Add fields or use a template above</p>
                    </div>
                ) : (
                    <DndContext
                        sensors={sensors}
                        collisionDetection={closestCenter}
                        onDragEnd={handleDragEnd}
                    >
                        <SortableContext items={fields.map((f) => f.id)} strategy={verticalListSortingStrategy}>
                            <div className="space-y-2">
                                {fields.map((field) => (
                                    <SortableField
                                        key={field.id}
                                        field={field}
                                        isSelected={selectedField?.id === field.id}
                                        onSelect={setSelectedField}
                                        onRemove={removeField}
                                    />
                                ))}
                            </div>
                        </SortableContext>
                    </DndContext>
                )}
            </div>

            {/* Right: Config Panel */}
            {selectedField && (
                <FieldConfigPanel
                    field={selectedField}
                    onUpdate={updateField}
                    onClose={() => setSelectedField(null)}
                />
            )}
        </div>
    );
}
