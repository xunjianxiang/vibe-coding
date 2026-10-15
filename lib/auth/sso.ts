import "server-only";
import { createSsoAuth } from "@/lib/sso/sso-auth";
import { clearSession, readSession, writeSession } from "@/lib/auth/session";
import { requireEnvironment } from "@/lib/config";

export const SSO_CALLBACK_PATH = "/sso/callback";

export function createServerSso(callbackBaseUrl: string) {
  return createSsoAuth({
    clientId: requireEnvironment("SSO_CLIENT_ID"),
    callbackPath: SSO_CALLBACK_PATH,
    loginPagePath: "/login",
    hooks: {
      token: {
        read: async () => (await readSession())?.token,
        write: async (token, context) => {
          if (!context.payload.sub) throw new Error("Verified SSO token is missing sub.");
          await writeSession(token, context.payload.sub, context.expiresAt);
        },
        clear: clearSession,
      },
      navigation: { getCallbackBaseUrl: () => callbackBaseUrl },
    },
  });
}
