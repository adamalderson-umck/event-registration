const KENT_METHODIST_EMAIL = /^[^@\s]+@kentmethodist[.]org$/i;

interface AuthIdentity {
  provider?: string;
  identity_data?: {
    email?: string | null;
    email_verified?: boolean | string | null;
  } | null;
}

interface AuthUser {
  email?: string | null;
  email_confirmed_at?: string | null;
  identities?: AuthIdentity[] | null;
}

export function isKentMethodistEmail(email: unknown): boolean {
  return typeof email === "string" && KENT_METHODIST_EMAIL.test(email.trim());
}

export function isKentMethodistGoogleUser(user: AuthUser | null | undefined): boolean {
  return Boolean(
    user?.email_confirmed_at &&
      isKentMethodistEmail(user.email) &&
      user.identities?.some((identity) =>
        identity.provider === "google" &&
        isKentMethodistEmail(identity.identity_data?.email) &&
        (identity.identity_data?.email_verified === true ||
          identity.identity_data?.email_verified === "true")
      ),
  );
}
