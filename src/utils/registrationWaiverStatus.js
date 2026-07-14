const MEDIA_RELEASE_TITLE = 'media release';

export function getRegistrationWaiverStatuses(registration, waivers) {
    const definitions = Array.isArray(waivers) ? waivers : [];
    const records = Array.isArray(registration?.signature_records)
        ? registration.signature_records
        : [];
    const recordsByWaiverId = new Map(
        records.map((record) => [record?.waiverId, record])
    );

    const requiredWaivers = definitions.filter(
        (waiver) => waiver?.required !== false
    );
    const allRequiredSigned = requiredWaivers.length > 0
        && requiredWaivers.every((waiver) => {
            const record = recordsByWaiverId.get(waiver?.id);
            return record?.signed === true && record?.declined !== true;
        });

    const mediaWaiver = definitions.find(
        (waiver) => waiver?.required === false
            && typeof waiver.title === 'string'
            && waiver.title.trim().toLowerCase() === MEDIA_RELEASE_TITLE
    );
    const mediaRecord = mediaWaiver
        ? recordsByWaiverId.get(mediaWaiver.id)
        : null;

    let mediaDecision = 'Missing';
    if (mediaRecord?.declined === true) {
        mediaDecision = 'Declined';
    } else if (mediaRecord?.signed === true) {
        mediaDecision = 'Approved';
    }

    return {
        waiverStatus: allRequiredSigned ? 'Signed' : 'Missing',
        mediaDecision,
    };
}
