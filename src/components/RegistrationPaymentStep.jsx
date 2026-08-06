import React from 'react';
import TithelyGivingForm from './TithelyGivingForm';

export default function RegistrationPaymentStep({ event, registration }) {
    if (registration?.payment_method !== 'tithely') {
        return null;
    }

    return <TithelyGivingForm event={event} />;
}
