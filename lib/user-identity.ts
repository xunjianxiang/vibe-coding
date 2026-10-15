import type { SsoUserProfile } from "@/lib/sso/sso-auth";

export type UserIdentity = {
  sub: string;
  userid: string | null;
  name: string | null;
  email: string | null;
  avatar: string | null;
  displayName: string;
  initials: string;
};

export function toUserIdentity(profile: SsoUserProfile | null | undefined, sub: string): UserIdentity {
  const name = profile?.name ?? null;
  const email = profile?.email ?? null;
  const userid = profile?.userid ?? null;
  const displayName = name ?? email ?? userid ?? sub;

  return {
    sub,
    userid,
    name,
    email,
    avatar: profile?.avatar ?? null,
    displayName,
    initials: displayName.trim().slice(0, 2).toUpperCase(),
  };
}

export function indexSsoUsers(users: SsoUserProfile[]) {
  const index = new Map<string, SsoUserProfile>();

  for (const user of users) {
    for (const value of [user.sub, user.raw?.sub, user.raw?.id, user.raw?.user_id, user.raw?.userid, user.userid]) {
      if (typeof value === "string" && value) index.set(value, user);
      if (typeof value === "number") index.set(String(value), user);
    }
  }

  return index;
}
