import { CodeBrowser, Lock01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import { login } from "./actions";

async function LoginContent({ searchParams }: { searchParams: Promise<{ error?: string; status?: string }> }) {
  const params = await searchParams;
  const message = params.error
    ? "登录未完成，请重新发起认证。"
    : params.status === "logged-out"
      ? "你已安全退出当前开发平台。"
      : "使用内部统一身份进入开发工作区。";

  return (
    <main className="flex min-h-screen bg-primary">
      <section className="mx-auto flex w-full max-w-7xl flex-col px-6 py-8 lg:px-8">
        <div className="flex items-center gap-3 text-primary">
          <span className="flex size-9 items-center justify-center rounded-lg bg-brand-solid text-white shadow-xs-skeuomorphic">
            <CodeBrowser className="size-5" />
          </span>
          <span className="text-md font-semibold">Vibe Coding</span>
        </div>

        <div className="flex flex-1 items-center justify-center py-16">
          <div className="w-full max-w-sm">
            <div className="mb-6 flex size-12 items-center justify-center rounded-xl bg-brand-primary text-fg-brand-primary ring-1 ring-brand">
              <Lock01 className="size-6" />
            </div>
            <h1 className="text-display-sm font-semibold text-primary">进入开发平台</h1>
            <p className="mt-3 text-md text-tertiary">{message}</p>
            <form action={login} className="mt-8">
              <Button type="submit" size="lg" className="w-full">使用 SSO Console 登录</Button>
            </form>
            <p className="mt-5 text-sm text-quaternary">认证凭据仅保存在服务端会话中。</p>
          </div>
        </div>
      </section>
    </main>
  );
}
import { Suspense } from "react";

export default function LoginPage(props: { searchParams: Promise<{ error?: string; status?: string }> }) {
  return <Suspense fallback={<main className="min-h-screen bg-primary" />}><LoginContent {...props} /></Suspense>;
}
