"use client";

import { Button } from "@/components/base/buttons/button";
import { UserIdentity } from "@/components/user-identity";
import type { UserIdentity as UserIdentityData } from "@/lib/user-identity";
import { cx } from "@/utils/cx";

export function HeaderUser({
  user,
  showLogout = true,
  className,
}: {
  user: UserIdentityData;
  showLogout?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex shrink-0 items-center gap-3", className)}>
      <UserIdentity user={user} hideDetailsOnMobile className="max-w-56" />
      {showLogout && (
        <form action="/logout" method="post">
          <Button type="submit" color="tertiary" size="sm">退出</Button>
        </form>
      )}
    </div>
  );
}
