const ELIGIBLE_PAYMENT_METHODS = new Set(['tithely', 'in_person']);

export function canMarkRegistrationPaid(registration) {
    return Boolean(
        registration
        && registration.status === 'confirmed'
        && registration.payment_status === 'pending'
        && ELIGIBLE_PAYMENT_METHODS.has(registration.payment_method)
    );
}
