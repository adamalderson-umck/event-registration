import { describe, expect, it } from 'vitest';
import { getRegistrationWaiverStatuses } from '../registrationWaiverStatus';

const liabilityWaiver = {
    id: 'waiver-liability',
    title: 'Liability Waiver',
    required: true,
};

const medicalWaiver = {
    id: 'waiver-medical',
    title: 'Medical Authorization',
    required: true,
};

const mediaRelease = {
    id: 'waiver-media',
    title: 'MEDIA RELEASE',
    required: false,
};

const optionalSurvey = {
    id: 'waiver-survey',
    title: 'Optional Survey',
    required: false,
};

function registration(signatureRecords) {
    return { signature_records: signatureRecords };
}

describe('getRegistrationWaiverStatuses', () => {
    it('returns Signed and Approved for matching signed records', () => {
        const result = getRegistrationWaiverStatuses(
            registration([
                { waiverId: 'waiver-liability', signed: true, declined: false },
                { waiverId: 'waiver-media', signed: true, declined: false },
            ]),
            [liabilityWaiver, mediaRelease]
        );

        expect(result).toEqual({
            waiverStatus: 'Signed',
            mediaDecision: 'Approved',
        });
    });

    it('requires every required waiver to be signed', () => {
        const result = getRegistrationWaiverStatuses(
            registration([
                { waiverId: 'waiver-liability', signed: true, declined: false },
                { waiverId: 'waiver-medical', signed: true, declined: false },
            ]),
            [liabilityWaiver, medicalWaiver, optionalSurvey]
        );

        expect(result.waiverStatus).toBe('Signed');
        expect(result.mediaDecision).toBe('Missing');
    });

    it('returns Missing when any required waiver record is absent', () => {
        const result = getRegistrationWaiverStatuses(
            registration([
                { waiverId: 'waiver-liability', signed: true, declined: false },
                { waiverId: 'waiver-media', signed: true, declined: false },
            ]),
            [liabilityWaiver, medicalWaiver, mediaRelease]
        );

        expect(result).toEqual({
            waiverStatus: 'Missing',
            mediaDecision: 'Approved',
        });
    });

    it('returns Declined for an explicit media decline', () => {
        const result = getRegistrationWaiverStatuses(
            registration([
                { waiverId: 'waiver-liability', signed: true, declined: false },
                { waiverId: 'waiver-media', signed: false, declined: true },
            ]),
            [liabilityWaiver, mediaRelease]
        );

        expect(result).toEqual({
            waiverStatus: 'Signed',
            mediaDecision: 'Declined',
        });
    });

    it('returns Missing when the media definition or record is absent', () => {
        expect(
            getRegistrationWaiverStatuses(
                registration([{ waiverId: 'waiver-liability', signed: true }]),
                [liabilityWaiver, optionalSurvey]
            )
        ).toEqual({
            waiverStatus: 'Signed',
            mediaDecision: 'Missing',
        });
    });

    it('treats malformed collections as missing instead of throwing', () => {
        expect(
            getRegistrationWaiverStatuses(
                { signature_records: 'not-an-array' },
                { waivers: 'not-an-array' }
            )
        ).toEqual({
            waiverStatus: 'Missing',
            mediaDecision: 'Missing',
        });
    });

    it('gives an explicit decline precedence over a contradictory signed flag', () => {
        const result = getRegistrationWaiverStatuses(
            registration([
                { waiverId: 'waiver-liability', signed: true, declined: false },
                { waiverId: 'waiver-media', signed: true, declined: true },
            ]),
            [liabilityWaiver, mediaRelease]
        );

        expect(result.mediaDecision).toBe('Declined');
    });
});
