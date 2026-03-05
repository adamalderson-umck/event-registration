import React from 'react';
import { Building2, ChevronRight } from 'lucide-react';
import Card from './ui/Card';

export default function OrgPicker({ orgs, onSelect }) {
    if (!orgs || orgs.length === 0) return null;

    return (
        <div className="max-w-lg mx-auto">
            <div className="text-center mb-8">
                <div className="bg-primary/10 p-3 rounded-full inline-block mb-4">
                    <Building2 className="w-8 h-8 text-primary" />
                </div>
                <h2 className="text-2xl font-bold text-slate-900">Select Organization</h2>
                <p className="text-slate-500 mt-1">Choose which organization to manage</p>
            </div>

            <div className="space-y-3">
                {orgs.map((org) => (
                    <Card
                        key={org.id}
                        className="p-4 cursor-pointer hover:border-primary hover:shadow-md transition-all duration-200 group"
                        onClick={() => onSelect(org)}
                    >
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <div className="bg-primary/10 p-2 rounded-lg group-hover:bg-primary/20 transition-colors">
                                    <Building2 className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <h3 className="font-semibold text-slate-900">{org.name}</h3>
                                    <p className="text-xs text-slate-400">{org.slug}</p>
                                </div>
                            </div>
                            <ChevronRight className="w-5 h-5 text-slate-300 group-hover:text-primary transition-colors" />
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
}
