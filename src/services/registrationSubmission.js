export const RECENT_REGISTRATION_ERROR = 'recent_registration';
export const AVAILABILITY_CHANGED_ERROR = 'availability_changed';

export async function getRegistrationSubmissionErrorCode(error) {
    const response = error?.context;
    if (!response || typeof response.clone !== 'function') {
        return null;
    }

    try {
        const body = await response.clone().json();
        return typeof body?.error === 'string' ? body.error : null;
    } catch {
        return null;
    }
}
