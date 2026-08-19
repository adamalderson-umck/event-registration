import sourceSans3Url from '@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2?url';
import umcKentLogoUrl from '../assets/parking-pass/UMC_of_Kent_logo.svg?url';
import { PARKING_FIELD_IDS } from '../config/eventPresets';
import {
    canPrintParkingPass,
    getParkingFieldValue,
    getParkingVehicleLabel,
} from './parkingRegistration';

const DEFAULT_PARKING_PASS_ASSETS = Object.freeze({
    logoUrl: umcKentLogoUrl,
    fontUrl: sourceSans3Url,
});

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function escapeCssUrl(value) {
    return Array.from(String(value ?? ''), (character) => {
        const codePoint = character.codePointAt(0);

        if (character === '\\') return '\\\\';
        if (character === "'") return "\\'";
        if (character === '<' || codePoint <= 0x1F || codePoint === 0x7F) {
            return `\\${codePoint.toString(16)} `;
        }

        return character;
    }).join('');
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

export function buildParkingPassHtml(registration, event, organization, assets = DEFAULT_PARKING_PASS_ASSETS) {
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
    const dates = escapeHtml(`${formatDate(event?.start_date)} - ${formatDate(event?.end_date)}`);
    const logoUrl = escapeHtml(assets.logoUrl);
    const fontUrl = escapeCssUrl(assets.fontUrl);

    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${eventTitle} Parking Pass</title>
<style>
@page { size: letter portrait; margin: 0; }
@font-face { font-family: 'Source Sans 3'; src: url('${fontUrl}') format('woff2'); font-style: normal; font-weight: 200 900; font-display: swap; }
html, body { width: 8.5in; height: 11in; margin: 0; overflow: hidden; }
body { box-sizing: border-box; font-family: 'Source Sans 3', Arial, sans-serif; color: #111; }
* { box-sizing: border-box; }
.pass { position: relative; width: 8.5in; height: 3.66in; overflow: hidden; }
.pass-artwork { position: absolute; top: 0; left: 0; width: 3.66in; height: 8.5in; overflow: hidden; transform: translateX(8.5in) rotate(90deg); transform-origin: top left; border: 2px solid #111; padding: .18in; display: flex; flex-direction: column; background: #fff; }
.brand { display: grid; grid-template-columns: .58in 1fr; gap: .12in; align-items: center; }
.brand-logo { width: .54in; height: .54in; object-fit: contain; filter: grayscale(1) brightness(0); }
.organization { font-size: 11pt; font-weight: 700; line-height: 1.05; }
.event { font-size: 10pt; font-weight: 800; line-height: 1.1; margin-top: .04in; }
.main { position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; overflow: hidden; }
.watermark { position: absolute; width: 6.6in; height: 6.6in; left: 50%; top: 52%; transform: translate(-50%, -50%); object-fit: contain; filter: grayscale(1) brightness(0); opacity: .045; }
.main > div:not(.watermark) { position: relative; }
.valid { border: 2px solid #111; background: #fff; color: #111; font-size: 13pt; font-weight: 900; letter-spacing: .035in; padding: .07in .16in; }
.plate { font-size: 42pt; line-height: .95; font-weight: 900; letter-spacing: .025in; margin-top: .15in; word-break: break-word; }
.plate-rule { width: 100%; border-top: 2px solid #111; margin-top: .11in; }
.vehicle { font-size: 11pt; font-weight: 700; text-transform: uppercase; margin-top: .09in; }
.advisory { border-top: 1px solid #aaa; border-bottom: 1px solid #aaa; color: #777; font-size: 10pt; font-weight: 800; text-align: center; padding: .08in 0; }
.pass-footer { display: grid; grid-template-columns: 1fr 1fr; gap: .18in; margin-top: .13in; }
.pass-footer > div:last-child { text-align: right; }
.meta-label { color: #777; font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: .02in; }
.meta-value { font-size: 9pt; font-weight: 700; margin-top: .02in; }
.direction { text-align: center; font-size: 8pt; font-weight: 600; margin-top: .1in; }
</style></head><body>
<main class="pass">
  <div class="pass-artwork">
    <header class="brand"><img class="brand-logo" src="${logoUrl}" alt="${organizationName} logo"><div><div class="organization">${organizationName}</div><div class="event">${eventTitle}</div></div></header>
    <section class="main"><img class="watermark" src="${logoUrl}" alt="" aria-hidden="true"><div class="valid">VALID PARKING PASS</div><div class="plate">${escapeHtml(licensePlate)}</div><div class="plate-rule"></div><div class="vehicle">${escapeHtml(vehicle)}</div></section>
    <div class="advisory">Parking permitted in designated areas only.</div>
    <footer class="pass-footer"><div><div class="meta-label">Valid term</div><div class="meta-value">${dates}</div></div><div><div class="meta-label">Reference</div><div class="meta-value">${registrationId}</div></div></footer>
    <div class="direction">Display this pass clearly in your vehicle.</div>
  </div>
</main></body></html>`;
}

const PRINT_ASSET_TIMEOUT_MS = 1500;

function waitForImage(image) {
    if (image.complete) return Promise.resolve();

    return new Promise((resolve) => {
        image.addEventListener('load', resolve, { once: true });
        image.addEventListener('error', resolve, { once: true });
    });
}

function settleWithin(promise, timeoutMs) {
    return new Promise((resolve) => {
        const timeoutId = window.setTimeout(resolve, timeoutMs);

        Promise.resolve(promise).catch(() => undefined).then(() => {
            window.clearTimeout(timeoutId);
            resolve();
        });
    });
}

function waitForPrintAssets(printWindow) {
    const document = printWindow.document;
    const fontsReady = Promise.resolve(document.fonts?.ready ?? Promise.resolve()).catch(() => undefined);
    const imagesReady = Promise.all(Array.from(document.images ?? [], waitForImage));

    return settleWithin(Promise.all([fontsReady, imagesReady]), PRINT_ASSET_TIMEOUT_MS);
}

export function printParkingPass(registration, event, organization) {
    const html = buildParkingPassHtml(registration, event, organization);
    const printWindow = window.open('', '_blank', 'width=900,height=900,resizable=yes,scrollbars=yes');
    if (!printWindow) {
        throw new Error('Allow popups to print the parking pass.');
    }

    printWindow.document.write(html);
    printWindow.document.close();
    return waitForPrintAssets(printWindow).then(() => {
        printWindow.focus();
        let closed = false;
        const closePreview = () => {
            if (closed) return;
            closed = true;
            printWindow.close();
        };
        printWindow.addEventListener?.('afterprint', closePreview, { once: true });
        try {
            printWindow.print();
        } finally {
            closePreview();
        }
    });
}
