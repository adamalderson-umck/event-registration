import React from 'react';

const COLORS = [
    '#2563eb', '#8b5cf6', '#06b6d4', '#f59e0b',
    '#10b981', '#ef4444', '#ec4899', '#6366f1',
];

/**
 * EventDonutChart renders a segmented SVG donut chart showing
 * per-event registration counts for active events.
 */
export default function EventDonutChart({ events }) {
    const activeEvents = events.filter((e) => e.status === 'active' && (e.registration_count || 0) > 0);
    const total = activeEvents.reduce((sum, e) => sum + (e.registration_count || 0), 0);

    // SVG settings
    const size = 160;
    const strokeWidth = 24;
    const radius = (size - strokeWidth) / 2;
    const circumference = 2 * Math.PI * radius;
    const cx = size / 2;
    const cy = size / 2;

    // Build segments with pre-computed offsets
    const offsets = activeEvents.reduce((acc, event, idx) => {
        if (idx === 0) return [0];
        const prevCount = activeEvents[idx - 1].registration_count || 0;
        const prevRatio = total > 0 ? prevCount / total : 0;
        return [...acc, acc[idx - 1] + prevRatio * circumference];
    }, [0]);

    const segments = activeEvents.map((event, i) => {
        const count = event.registration_count || 0;
        const ratio = total > 0 ? count / total : 0;
        const dashLength = ratio * circumference;
        const gapLength = circumference - dashLength;

        return {
            event,
            color: COLORS[i % COLORS.length],
            count,
            dashArray: `${dashLength} ${gapLength}`,
            dashOffset: -offsets[i],
        };
    });

    if (activeEvents.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center py-4">
                <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
                    <circle
                        cx={cx} cy={cy} r={radius}
                        fill="none"
                        stroke="#e2e8f0"
                        strokeWidth={strokeWidth}
                    />
                    <text x={cx} y={cy - 6} textAnchor="middle" className="text-2xl font-bold fill-slate-300">
                        0
                    </text>
                    <text x={cx} y={cy + 12} textAnchor="middle" className="text-[10px] fill-slate-400">
                        registrations
                    </text>
                </svg>
                <p className="text-xs text-slate-400 mt-3">No active events with registrations</p>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-center">
            {/* Donut */}
            <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="transform -rotate-90">
                {segments.map((seg) => (
                    <circle
                        key={seg.event.id}
                        cx={cx} cy={cy} r={radius}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth={strokeWidth}
                        strokeDasharray={seg.dashArray}
                        strokeDashoffset={seg.dashOffset}
                        strokeLinecap="butt"
                        className="transition-all duration-500"
                    />
                ))}
                {/* Center text — counter-rotate so it reads normally */}
                <text
                    x={cx} y={cy - 6}
                    textAnchor="middle"
                    className="text-2xl font-bold fill-slate-900"
                    transform={`rotate(90, ${cx}, ${cy})`}
                >
                    {total}
                </text>
                <text
                    x={cx} y={cy + 12}
                    textAnchor="middle"
                    className="text-[10px] fill-slate-500"
                    transform={`rotate(90, ${cx}, ${cy})`}
                >
                    registrations
                </text>
            </svg>

            {/* Legend */}
            <div className="mt-4 space-y-1.5 w-full">
                {segments.map((seg) => (
                    <div key={seg.event.id} className="flex items-center gap-2 text-sm">
                        <span
                            className="w-3 h-3 rounded-full shrink-0"
                            style={{ backgroundColor: seg.color }}
                        />
                        <span className="truncate text-slate-700 flex-1">{seg.event.title}</span>
                        <span className="font-semibold text-slate-900 tabular-nums">{seg.count}</span>
                    </div>
                ))}
            </div>
        </div>
    );
}
