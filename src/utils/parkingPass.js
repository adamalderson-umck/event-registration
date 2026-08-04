import { PARKING_FIELD_IDS } from '../config/eventPresets';
import {
    canPrintParkingPass,
    getParkingFieldValue,
    getParkingVehicleLabel,
} from './parkingRegistration';

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function formatDate(value) {
    if (!value) return 'Open term';

    const dateOnly = String(value).slice(0, 10);
    const date = new Date(`${dateOnly}T00:00:00`);
    if (Number.isNaN(date.getTime())) return 'Open term';

    return date.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
    });
}

function getOrganizationName(organization) {
    return organization?.name ?? organization;
}

export function buildParkingPassHtml(registration, event, organization) {
    if (!canPrintParkingPass(registration)) {
        throw new Error('Only valid parking registrations can be printed.');
    }

    const licensePlate = getParkingFieldValue(registration, PARKING_FIELD_IDS.LICENSE_PLATE);
    const vehicle = getParkingVehicleLabel(registration);
    if (!licensePlate || !vehicle) {
        throw new Error('Required parking pass values are missing.');
    }

    const eventTitle = escapeHtml(event?.title);
    const organizationName = escapeHtml(getOrganizationName(organization));
    const registrationId = escapeHtml(String(registration?.id ?? '').slice(0, 8));
    const dates = `${formatDate(event?.start_date)} - ${formatDate(event?.end_date)}`;

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${eventTitle} Parking Pass</title>
<style>
@page { size: 2.833in 11in; margin: 0; }
html, body { width: 2.833in; height: 11in; margin: 0; }
body { box-sizing: border-box; padding: .22in; font-family: Arial, sans-serif; color: #111; }
* { box-sizing: border-box; }
.pass { width: 2.393in; height: 10.56in; border: 2px solid #111; padding: .18in .12in; text-align: center; display: flex; flex-direction: column; justify-content: space-between; }
.organization { font-size: 10pt; font-weight: 700; }
.event { font-size: 9pt; margin-top: .08in; }
.valid { font-size: 16pt; font-weight: 800; letter-spacing: .03in; margin: .3in 0; }
.plate { font-size: 18pt; font-weight: 800; border: 2px solid #111; padding: .12in .04in; word-break: break-word; }
.vehicle { font-size: 10pt; font-weight: 700; margin-top: .14in; }
.dates, .reference, .direction { font-size: 8pt; line-height: 1.35; }
</style></head><body>
<main class="pass">
  <div><div class="organization">${organizationName}</div><div class="event">${eventTitle}</div></div>
  <div><div class="valid">VALID PARKING PASS</div><div class="plate">${escapeHtml(licensePlate)}</div><div class="vehicle">${escapeHtml(vehicle)}</div></div>
  <div><div class="dates">${escapeHtml(dates)}</div><div class="reference">Pass reference: ${registrationId}</div><div class="direction">Display this pass clearly in your vehicle.</div></div>
</main></body></html>`;
}

export function printParkingPass(registration, event, organization) {
    const html = buildParkingPassHtml(registration, event, organization);
    const printWindow = window.open('', '_blank', 'width=408,height=1200');
    if (!printWindow) {
        throw new Error('Allow popups to print the parking pass.');
    }

    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 250);
}
