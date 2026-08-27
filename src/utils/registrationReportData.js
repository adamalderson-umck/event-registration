import { getParkingPassStatus } from './parkingRegistration';

export function getRegistrationFormData(registration) {
    let data = registration?.form_data;
    if (typeof data === 'string') {
        try {
            data = JSON.parse(data);
        } catch {
            return {};
        }
    }
    return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
}

const parkingColumns = [
    { label: 'Pass Status', value: getParkingPassStatus },
    { label: 'Pass Finalized At', value: registration => registration.parking_pass_finalized_at || '', date: true },
    { label: 'Pass Finalized By', value: registration => registration.parking_pass_finalized_by_name || '' },
];

export function getParkingReportColumns(event) {
    return event?.event_type === 'parking' ? parkingColumns : [];
}
