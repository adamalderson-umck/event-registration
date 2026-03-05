const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");

/**
 * resolveMemberEmail — Callable Cloud Function
 *
 * Called by the org owner to add a member by email.
 * Resolves the email to a Firebase UID, then adds them to the org's members array.
 * If the user hasn't signed in yet, stores as a pending invite.
 */
exports.resolveMemberEmail = onCall(async (request) => {
    // Auth check
    if (!request.auth) {
        throw new HttpsError("unauthenticated", "Must be signed in");
    }

    const { orgId, email } = request.data;

    if (!orgId || !email) {
        throw new HttpsError("invalid-argument", "orgId and email are required");
    }

    const db = getFirestore();
    const auth = getAuth();

    // Verify caller is org owner
    const orgRef = db.collection("organizations").doc(orgId);
    const orgSnap = await orgRef.get();

    if (!orgSnap.exists) {
        throw new HttpsError("not-found", "Organization not found");
    }

    const orgData = orgSnap.data();
    if (orgData.ownerUid !== request.auth.uid) {
        throw new HttpsError("permission-denied", "Only the org owner can add members");
    }

    // Try to resolve email to UID
    try {
        const userRecord = await auth.getUserByEmail(email.trim().toLowerCase());

        // Check if already a member
        if (orgData.members && orgData.members.includes(userRecord.uid)) {
            return { status: "already_member", uid: userRecord.uid };
        }

        // Add to members array
        await orgRef.update({
            members: FieldValue.arrayUnion(userRecord.uid),
        });

        return { status: "added", uid: userRecord.uid, displayName: userRecord.displayName };
    } catch (err) {
        if (err.code === "auth/user-not-found") {
            // User hasn't signed in yet — store as pending invite
            await orgRef.update({
                pendingInvites: FieldValue.arrayUnion(email.trim().toLowerCase()),
            });

            return { status: "pending", email: email.trim().toLowerCase() };
        }

        throw new HttpsError("internal", err.message);
    }
});
