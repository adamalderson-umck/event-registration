const { onSchedule } = require("firebase-functions/v2/scheduler");
const { getFirestore, Timestamp } = require("firebase-admin/firestore");
const nodemailer = require("nodemailer");
const { weeklyDigestEmail } = require("./emailTemplates");

/**
 * weeklyDigest — Scheduled Cloud Function
 *
 * Runs every Monday at 8:00 AM ET. For each org with events that have
 * weeklyDigest enabled, compiles stats and sends a digest email to organizers.
 */
exports.weeklyDigest = onSchedule(
    {
        schedule: "every monday 08:00",
        timeZone: "America/New_York",
    },
    async () => {
        const db = getFirestore();

        // Get all organizations
        const orgsSnap = await db.collection("organizations").get();

        for (const orgDoc of orgsSnap.docs) {
            const orgData = orgDoc.data();

            // Skip orgs without SMTP config
            if (!orgData.smtpConfig?.host) continue;

            // Create transporter for this org
            const transporter = nodemailer.createTransport({
                host: orgData.smtpConfig.host,
                port: orgData.smtpConfig.port || 465,
                secure: (orgData.smtpConfig.port || 465) === 465,
                auth: orgData.smtpConfig.auth
                    ? { user: orgData.smtpConfig.auth.user, pass: orgData.smtpConfig.auth.pass }
                    : undefined,
            });

            // Get events with weekly digest enabled
            const eventsSnap = await db
                .collection("organizations").doc(orgDoc.id)
                .collection("events")
                .where("notifications.weeklyDigest", "==", true)
                .get();

            for (const eventDoc of eventsSnap.docs) {
                const event = eventDoc.data();
                const organizers = event.notifications?.organizers || [];

                if (organizers.length === 0) continue;

                // Check if today matches the configured digest day
                const today = new Date();
                const dayName = today.toLocaleDateString("en-US", { weekday: "long" }).toLowerCase();
                const digestDay = event.notifications?.digestDay || "monday";
                if (dayName !== digestDay) continue;

                try {
                    // Calculate week range
                    const weekEnd = new Date();
                    const weekStart = new Date();
                    weekStart.setDate(weekStart.getDate() - 7);

                    // Count registrations from this week
                    const regsSnap = await db
                        .collection("organizations").doc(orgDoc.id)
                        .collection("registrations")
                        .where("eventId", "==", eventDoc.id)
                        .where("createdAt", ">=", Timestamp.fromDate(weekStart))
                        .get();

                    const allRegsSnap = await db
                        .collection("organizations").doc(orgDoc.id)
                        .collection("registrations")
                        .where("eventId", "==", eventDoc.id)
                        .get();

                    const allRegs = allRegsSnap.docs.map((d) => d.data());
                    const confirmed = allRegs.filter((r) => r.status === "confirmed").length;
                    const waitlisted = allRegs.filter((r) => r.status === "waitlisted").length;

                    const html = weeklyDigestEmail({
                        eventTitle: event.title,
                        weekStart: weekStart.toLocaleDateString(),
                        weekEnd: weekEnd.toLocaleDateString(),
                        newRegistrations: regsSnap.size,
                        totalRegistrations: allRegs.length,
                        capacity: event.capacity,
                        confirmedCount: confirmed,
                        waitlistedCount: waitlisted,
                    });

                    // Send to all organizers
                    await transporter.sendMail({
                        from: `"${orgData.smtpConfig.fromName || orgData.name}" <${orgData.smtpConfig.fromEmail}>`,
                        to: organizers.join(", "),
                        subject: `Weekly Digest: ${event.title}`,
                        html,
                    });

                    console.log(`Digest sent for ${event.title} to ${organizers.length} organizers`);
                } catch (err) {
                    console.error(`Digest error for event ${eventDoc.id}:`, err);
                }
            }
        }
    }
);
