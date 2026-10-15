"use client";

import { Avatar } from "@/components/base/avatar/avatar";
import type { UserIdentity as UserIdentityData } from "@/lib/user-identity";
import { cx } from "@/utils/cx";

export function UserIdentity({
  user,
  subtitle,
  isCurrentUser = false,
  hideDetailsOnMobile = false,
  className,
}: {
  user: UserIdentityData;
  subtitle?: string;
  isCurrentUser?: boolean;
  hideDetailsOnMobile?: boolean;
  className?: string;
}) {
  const secondary = subtitle ?? user.email ?? user.userid ?? user.sub;

  return (
    <div className={cx("flex min-w-0 items-center gap-2.5", className)}>
      <div className="shrink-0">
        <Avatar
          size="sm"
          src={user.avatar}
          initials={user.initials}
          alt={isCurrentUser ? `${user.displayName}，当前用户` : user.displayName}
          border
          className={isCurrentUser ? "ring-2 ring-brand ring-offset-2 ring-offset-primary" : undefined}
        />
        {isCurrentUser && <span className="sr-only">当前用户</span>}
      </div>
      <div className={cx("min-w-0", hideDetailsOnMobile && "hidden sm:block")}>
        <p className="truncate text-sm font-medium text-primary">{user.displayName}</p>
        <p className="truncate text-xs text-quaternary">{secondary}</p>
      </div>
    </div>
  );
}
