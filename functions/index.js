const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const nodemailer = require("nodemailer");
const {
    generateCancelToken,
    confirmationEmail,
    cancellationEmail,
    waitlistPromotionEmail,
    organizerNotificationEmail,
} = require("./emailTemplates");

// Re-export sub-modules
const { resolveMemberEmail } = require("./resolveMemberEmail");
const { weeklyDigest } = require("./weeklyDigest");
exports.resolveMemberEmail = resolveMemberEmail;
exports.weeklyDigest = weeklyDigest;

// Initialize Firebase Admin
initializeApp();

// Hosting base URL (configure via Firebase env or default)
const BASE_URL = process.env.BASE_URL || "https://event-registration-b7840.web.app";

/**
 * Helper: create a nodemailer transporter from org SMTP config.
 * Returns null if no SMTP config is available.
 */
function createTransporter(org) {
    if (!org.smtpConfig?.host) return null;

    return nodemailer.createTransport({
        host: org.smtpConfig.host,
        port: org.smtpConfig.port || 465,
        secure: (org.smtpConfig.port || 465) === 465,
        auth: org.smtpConfig.auth
            ? { user: org.smtpConfig.auth.user, pass: org.smtpConfig.auth.pass }
            : undefined,
    });
}

/**
 * Helper: get org data with SMTP config
 */
async function getOrgData(db, orgId) {
    const orgSnap = await db.collection("organizations").doc(orgId).get();
    return orgSnap.exists ? orgSnap.data() : null;
}

/**
 * Helper: get event data
 */
async function getEventData(db, orgId, eventId) {
    const eventSnap = await db
        .collection("organizations").doc(orgId)
        .collection("events").doc(eventId)
        .get();
    return eventSnap.exists ? { id: eventSnap.id, ...eventSnap.data() } : null;
}

/**
 * onRegistrationCreated
 *
 * Triggered when a new registration is created in any org.
 * - Increments registrationCount on the event
 * - Determines confirmed vs waitlisted status
 * - Sends confirmation email to registrant
 * - Sends per-registration notification to organizers (if enabled)
 */
exports.onRegistrationCreated = onDocumentCreated(
    "organizations/{orgId}/registrations/{regId}",
    async (event) => {
        const db = getFirestore();
        const snap = event.data;
        if (!snap) return;

        const regData = snap.data();
        const { orgId, regId } = event.params;
        const eventId = regData.eventId;

        if (!eventId) {
            console.error("Registration missing eventId:", regId);
            return;
        }

        try {
            // Get event data
            const eventData = await getEventData(db, orgId, eventId);
            if (!eventData) {
                console.error("Event not found:", eventId);
                return;
            }

            // Get org data for SMTP
            const orgData = await getOrgData(db, orgId);

            // Determine status based on capacity
            const currentCount = eventData.registrationCount || 0;
            let status = "confirmed";

            if (eventData.capacity && currentCount >= eventData.capacity) {
                if (eventData.waitlistEnabled) {
                    status = "waitlisted";
                } else {
                    // Event is full and no waitlist — shouldn't normally happen
                    // but handle gracefully
                    status = "confirmed";
                }
            }

            // Update registration status
            const regRef = db
                .collection("organizations").doc(orgId)
                .collection("registrations").doc(regId);
            await regRef.update({ status });

            // Increment event counters
            const eventRef = db
                .collection("organizations").doc(orgId)
                .collection("events").doc(eventId);

            const counterUpdate = status === "waitlisted"
                ? { waitlistCount: FieldValue.increment(1) }
                : { registrationCount: FieldValue.increment(1) };
            await eventRef.update(counterUpdate);

            // Send confirmation email to registrant
            const transporter = createTransporter(orgData);
            if (transporter) {
                const emailField = (eventData.formFields || []).find(
                    (f) => f.type === "email"
                );
                const registrantEmail = emailField
                    ? regData.formData?.[emailField.id]
                    : null;

                if (registrantEmail) {
                    const cancelToken = generateCancelToken(orgId, regId);
                    const cancelUrl = `${BASE_URL}/?cancel=true&token=${encodeURIComponent(cancelToken)}`;

                    const eventDate = eventData.startDate
                        ? new Date(eventData.startDate).toLocaleDateString("en-US", {
                            weekday: "long",
                            year: "numeric",
                            month: "long",
                            day: "numeric",
                        })
                        : null;

                    const html = confirmationEmail({
                        eventTitle: eventData.title,
                        eventDate,
                        eventLocation: eventData.location,
                        formData: regData.formData,
                        formFields: eventData.formFields,
                        status,
                        cancelUrl,
                    });

                    await transporter.sendMail({
                        from: `"${orgData.smtpConfig.fromName || orgData.name}" <${orgData.smtpConfig.fromEmail}>`,
                        to: registrantEmail,
                        subject: status === "waitlisted"
                            ? `Waitlist Confirmation: ${eventData.title}`
                            : `Registration Confirmed: ${eventData.title}`,
                        html,
                    });

                    console.log(`Confirmation email sent to ${registrantEmail} (${status})`);
                }

                // Per-registration organizer notification
                const organizers = eventData.notifications?.organizers || [];
                if (eventData.notifications?.perRegistration && organizers.length > 0) {
                    const html = organizerNotificationEmail({
                        eventTitle: eventData.title,
                        formData: regData.formData,
                        formFields: eventData.formFields,
                        registrationCount: currentCount + 1,
                        capacity: eventData.capacity,
                    });

                    await transporter.sendMail({
                        from: `"${orgData.smtpConfig.fromName || orgData.name}" <${orgData.smtpConfig.fromEmail}>`,
                        to: organizers.join(", "),
                        subject: `New Registration: ${eventData.title}`,
                        html,
                    });

                    console.log(`Organizer notification sent to ${organizers.length} organizers`);
                }
            }
        } catch (err) {
            console.error("onRegistrationCreated error:", err);
        }
    }
);

/**
 * onRegistrationUpdated
 *
 * Triggered when a registration is updated.
 * Handles:
 * - Cancellation: decrements count, sends cancellation email, promotes from waitlist
 */
exports.onRegistrationUpdated = onDocumentUpdated(
    "organizations/{orgId}/registrations/{regId}",
    async (event) => {
        const db = getFirestore();
        const before = event.data?.before?.data();
        const after = event.data?.after?.data();
        if (!before || !after) return;

        const { orgId, regId } = event.params;

        // Handle cancellation
        if (before.status !== "cancelled" && after.status === "cancelled") {
            const eventId = after.eventId;
            if (!eventId) return;

            try {
                const eventData = await getEventData(db, orgId, eventId);
                if (!eventData) return;

                const orgData = await getOrgData(db, orgId);

                // Decrement appropriate counter
                const eventRef = db
                    .collection("organizations").doc(orgId)
                    .collection("events").doc(eventId);

                if (before.status === "waitlisted") {
                    await eventRef.update({ waitlistCount: FieldValue.increment(-1) });
                } else {
                    await eventRef.update({ registrationCount: FieldValue.increment(-1) });

                    // Promote from waitlist if someone is waiting
                    if (eventData.waitlistEnabled && (eventData.waitlistCount || 0) > 0) {
                        await promoteFromWaitlist(db, orgId, eventId, eventData, orgData);
                    }
                }

                // Send cancellation email
                const transporter = createTransporter(orgData);
                if (transporter) {
                    const emailField = (eventData.formFields || []).find(
                        (f) => f.type === "email"
                    );
                    const registrantEmail = emailField
                        ? after.formData?.[emailField.id]
                        : null;

                    if (registrantEmail) {
                        const html = cancellationEmail({ eventTitle: eventData.title });

                        await transporter.sendMail({
                            from: `"${orgData.smtpConfig.fromName || orgData.name}" <${orgData.smtpConfig.fromEmail}>`,
                            to: registrantEmail,
                            subject: `Registration Cancelled: ${eventData.title}`,
                            html,
                        });

                        console.log(`Cancellation email sent to ${registrantEmail}`);
                    }
                }
            } catch (err) {
                console.error("onRegistrationUpdated (cancel) error:", err);
            }
        }
    }
);

/**
 * Atomic waitlist promotion.
 * Finds the oldest waitlisted registration, promotes it to confirmed,
 * and sends a promotion email.
 */
async function promoteFromWaitlist(db, orgId, eventId, eventData, orgData) {
    try {
        // Find oldest waitlisted registration for this event
        const waitlistSnap = await db
            .collection("organizations").doc(orgId)
            .collection("registrations")
            .where("eventId", "==", eventId)
            .where("status", "==", "waitlisted")
            .orderBy("createdAt", "asc")
            .limit(1)
            .get();

        if (waitlistSnap.empty) return;

        const promotedDoc = waitlistSnap.docs[0];
        const promotedData = promotedDoc.data();
        const promotedRef = promotedDoc.ref;

        // Promote: update status
        await promotedRef.update({ status: "confirmed", promotedAt: FieldValue.serverTimestamp() });

        // Update event counters: +1 confirmed, -1 waitlist
        const eventRef = db
            .collection("organizations").doc(orgId)
            .collection("events").doc(eventId);
        await eventRef.update({
            registrationCount: FieldValue.increment(1),
            waitlistCount: FieldValue.increment(-1),
        });

        // Send promotion email
        const transporter = createTransporter(orgData);
        if (transporter) {
            const emailField = (eventData.formFields || []).find(
                (f) => f.type === "email"
            );
            const email = emailField ? promotedData.formData?.[emailField.id] : null;

            if (email) {
                const cancelToken = generateCancelToken(orgId, promotedDoc.id);
                const cancelUrl = `${BASE_URL}/?cancel=true&token=${encodeURIComponent(cancelToken)}`;

                const eventDate = eventData.startDate
                    ? new Date(eventData.startDate).toLocaleDateString("en-US", {
                        weekday: "long",
                        year: "numeric",
                        month: "long",
                        day: "numeric",
                    })
                    : null;

                const html = waitlistPromotionEmail({
                    eventTitle: eventData.title,
                    eventDate,
                    eventLocation: eventData.location,
                    cancelUrl,
                });

                await transporter.sendMail({
                    from: `"${orgData.smtpConfig.fromName || orgData.name}" <${orgData.smtpConfig.fromEmail}>`,
                    to: email,
                    subject: `Spot Available! ${eventData.title}`,
                    html,
                });

                console.log(`Waitlist promotion email sent to ${email}`);
            }
        }
    } catch (err) {
        console.error("Waitlist promotion error:", err);
    }
}
