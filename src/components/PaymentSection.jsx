import React from 'react';
import { PayPalScriptProvider, PayPalButtons } from '@paypal/react-paypal-js';
import { supabase } from '../services/supabase';
import Card from './ui/Card';

const PAYPAL_CLIENT_ID = import.meta.env.VITE_PAYPAL_CLIENT_ID || 'test';

export default function PaymentSection({ registrationId, amount, onPaymentComplete }) {
    if (!amount || amount <= 0) return null;

    const handleApprove = async (data, actions) => {
        try {
            const details = await actions.order.capture();

            // Update registration with payment info via RPC
            if (registrationId) {
                const { error } = await supabase.rpc('update_payment_status', {
                    p_registration_id: registrationId,
                    p_payment_status: 'paid',
                    p_payment_method: 'paypal',
                    p_payment_details: {
                        payerEmail: details.payer?.email_address,
                        payerName: details.payer?.name?.given_name,
                        transactionId: details.purchase_units?.[0]?.payments?.captures?.[0]?.id,
                        paypalOrderId: details.id,
                        capturedAt: new Date().toISOString(),
                    },
                });

                if (error) throw error;
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
