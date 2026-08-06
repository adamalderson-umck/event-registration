import React from 'react';
import { PARKING_FIELD_IDS } from '../config/eventPresets';
import {
    canPrintParkingPass,
    getParkingFieldValue,
    getParkingPassStatus,
    getParkingVehicleLabel,
} from '../utils/parkingRegistration';
import { canRecordRegistrationPayment, formatPaymentSummary } from '../utils/paymentStatus';
import Card from './ui/Card';

const columnClassName = 'px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide';

export default function ParkingRegistrationTable({ registrations, onView, onRecordPayment, onPrintPass }) {
    return (
        <Card className="overflow-hidden">
            <div className="overflow-x-auto">
                <table className="w-full">
                    <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                            <th className={columnClassName}>Registrant</th>
                            <th className={columnClassName}>Email</th>
                            <th className={columnClassName}>License Plate</th>
                            <th className={columnClassName}>Vehicle</th>
                            <th className={columnClassName}>Registration</th>
                            <th className={columnClassName}>Payment</th>
                            <th className={columnClassName}>Pass</th>
                            <th className={columnClassName}>Actions</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {registrations.map((registration) => {
                            const firstName = getParkingFieldValue(registration, 'system_first_name');
                            const lastName = getParkingFieldValue(registration, 'system_last_name');
                            const eligibleToRecordPayment = canRecordRegistrationPayment(registration);

                            return (
                                <tr key={registration.id} className="hover:bg-slate-50 transition-colors">
                                    <td className="px-4 py-3 text-sm text-slate-700">
                                        {[firstName, lastName].filter(Boolean).join(' ')}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-700">
                                        {getParkingFieldValue(registration, 'system_email')}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-700">
                                        {getParkingFieldValue(registration, PARKING_FIELD_IDS.LICENSE_PLATE)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-700">
                                        {getParkingVehicleLabel(registration)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-700">
                                        {registration.status || 'pending'}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-700">
                                        {formatPaymentSummary(registration)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-700">
                                        {getParkingPassStatus(registration)}
                                    </td>
                                    <td className="px-4 py-3 text-sm text-slate-700">
                                        <div className="flex items-center gap-3">
                                            <button
                                                type="button"
                                                onClick={() => onView(registration)}
                                                className="text-primary hover:text-primary-dark font-medium cursor-pointer"
                                            >
                                                View
                                            </button>
                                            {eligibleToRecordPayment && (
                                                <button
                                                    type="button"
                                                    onClick={() => onRecordPayment(registration)}
                                                    className="text-primary hover:text-primary-dark font-medium cursor-pointer"
                                                >
                                                    Record Payment
                                                </button>
                                            )}
                                            {canPrintParkingPass(registration) && (
                                                <button
                                                    type="button"
                                                    onClick={() => onPrintPass(registration)}
                                                    className="text-primary hover:text-primary-dark font-medium cursor-pointer"
                                                >
                                                    Print Pass
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </Card>
    );
}
