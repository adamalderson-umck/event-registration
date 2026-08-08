export const RECENT_REGISTRATION_ERROR = 'recent_registration';

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
