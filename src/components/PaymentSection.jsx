import React from 'react';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import Card from './ui/Card';

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || 'test';

export default function PaymentSection({ orgId, registrationId, amount, onPaymentComplete }) {
    if (!amount || amount <= 0) return null;

    const handleApprove = async (data, actions) => {
        try {
            const details = await actions.order.capture();

            // Update registration with payment info
            if (registrationId) {
                const regRef = doc(db, 'organizations', orgId, 'registrations', registrationId);
                await updateDoc(regRef, {
                    paymentStatus: 'paid',
                    paymentMethod: 'paypal',
                    paymentId: details.id,
                    paymentDetails: {
                        payerEmail: details.payer?.email_address,
                        payerName: details.payer?.name?.given_name,
                        transactionId: details.purchase_units?.[0]?.payments?.captures?.[0]?.id,
                        capturedAt: new Date().toISOString(),
                    },
                });
            }

            onPaymentComplete?.({ success: true, details });
        } catch (err) {
            console.error('Payment capture error:', err);
            onPaymentComplete?.({ success: false, error: err.message });
        }
    };

    return (
        <Card className="p-5 border-primary/20">
            <div className="mb-4">
                <h3 className="text-sm font-semibold text-slate-700 uppercase tracking-wide mb-1">
                    Payment Required
                </h3>
                <p className="text-2xl font-bold text-slate-900">${amount.toFixed(2)}</p>
            </div>

            <PayPalScriptProvider
                options={{
                    clientId: PAYPAL_CLIENT_ID,
                    currency: 'USD',
                }}
            >
                <PayPalButtons
                    style={{
                        layout: 'vertical',
                        color: 'blue',
                        shape: 'rect',
                        label: 'pay',
                        height: 40,
                    }}
                    createOrder={(data, actions) => {
                        return actions.order.create({
                            purchase_units: [
                                {
                                    amount: {
                                        currency_code: 'USD',
                                        value: amount.toFixed(2),
                                    },
                                },
                            ],
                        });
                    }}
                    onApprove={handleApprove}
                    onError={(err) => {
                        console.error('PayPal error:', err);
                    }}
                />
            </PayPalScriptProvider>
        </Card>
    );
}
