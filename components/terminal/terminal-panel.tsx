"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { CpuChip01, Plus, TerminalSquare, XClose } from "@untitledui/icons";
import { Tab, TabList, Tabs } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { Dropdown } from "@/components/base/dropdown/dropdown";
import { TerminalCloseDialog } from "@/components/terminal/terminal-close-dialog";
import type { TerminalAgent, TerminalKind } from "@/lib/terminal-ticket";
import { cx } from "@/utils/cx";

const TerminalCanvas = dynamic(
  () => import("@/components/terminal/terminal-canvas").then((module) => module.TerminalCanvas),
  { ssr: false },
);

type TerminalTab = {
  id: string;
  title: string;
  kind: TerminalKind;
  agent?: TerminalAgent;
  closing: boolean;
};

const MAX_TERMINALS = 8;

function activeTerminalStorageKey(workspaceId: string) {
  return `vibe-coding:workspace:${workspaceId}:active-terminal`;
}

export function TerminalPanel({
  workspaceId,
  workspaceStatus,
  workspaceError,
  writable,
  accessReason,
}: {
  workspaceId: string;
  workspaceStatus: string;
  workspaceError?: string | null;
  writable: boolean;
  accessReason: "LEASE_INVALID" | "CONTAINER_CONFLICT" | "CONTAINER_NOT_RUNNING" | "WORKSPACE_NOT_RUNNING" | null;
}) {
  const [tabs, setTabs] = useState<TerminalTab[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingCreate, setPendingCreate] = useState(false);
  const [terminalError, setTerminalError] = useState<string | null>(null);
  const [closeTargetId, setCloseTargetId] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    void fetch(`/api/workspaces/${workspaceId}/terminals`, { cache: "no-store" })
      .then(async (response) => {
        const body = await response.json() as {
          terminals?: Array<Omit<TerminalTab, "closing">>;
          activeTerminalId?: string | null;
          error?: string;
        };
        if (!response.ok || !body.terminals) throw new Error(body.error || "无法加载终端。");
        if (disposed) return;
        const restored = body.terminals.map((terminal) => ({ ...terminal, closing: false }));
        let locallySelectedId: string | null = null;
        try {
          locallySelectedId = window.localStorage.getItem(activeTerminalStorageKey(workspaceId));
        } catch {
          // Server persistence remains available when browser storage is disabled.
        }
        const restoredIds = new Set(restored.map((terminal) => terminal.id));
        const restoredSelectedId = locallySelectedId && restoredIds.has(locallySelectedId)
          ? locallySelectedId
          : body.activeTerminalId && restoredIds.has(body.activeTerminalId)
            ? body.activeTerminalId
            : restored[0]?.id ?? null;
        setTabs(restored);
        setSelectedId(restoredSelectedId);
      })
      .catch((error) => {
        if (!disposed) setTerminalError(error instanceof Error ? error.message : "无法加载终端。");
      });
    return () => { disposed = true; };
  }, [workspaceId]);

  const selectTerminal = (terminalId: string | null, persistServer = true) => {
    setSelectedId(terminalId);
    try {
      if (terminalId) window.localStorage.setItem(activeTerminalStorageKey(workspaceId), terminalId);
      else window.localStorage.removeItem(activeTerminalStorageKey(workspaceId));
    } catch {
      // Server persistence remains available when browser storage is disabled.
    }
    if (!terminalId || !persistServer) return;
    void fetch(`/api/workspaces/${workspaceId}/terminals`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminalId }),
      keepalive: true,
    }).then(async (response) => {
      if (response.ok) return;
      const body = await response.json().catch(() => null) as { error?: string } | null;
      throw new Error(body?.error || "无法保存当前终端。");
    }).catch((error) => {
      setTerminalError(error instanceof Error ? error.message : "无法保存当前终端。");
    });
  };

  const openTerminal = async (kind: TerminalKind, agent?: TerminalAgent) => {
    if (tabs.length >= MAX_TERMINALS || pendingCreate) return;
    setPendingCreate(true);
    setTerminalError(null);
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}/terminals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, ...(agent ? { agent } : {}) }),
      });
      const body = await response.json() as { terminal?: Omit<TerminalTab, "closing">; error?: string };
      if (!response.ok || !body.terminal) throw new Error(body.error || "无法创建终端。");
      const terminal = { ...body.terminal, closing: false };
      setTabs((current) => [...current, terminal]);
      selectTerminal(terminal.id, false);
    } catch (error) {
      setTerminalError(error instanceof Error ? error.message : "无法创建终端。");
    } finally {
      setPendingCreate(false);
    }
  };

  const requestClose = async (id: string) => {
    setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, closing: true } : tab));
    setTerminalError(null);
    try {
      const response = await fetch(`/api/terminals/${id}`, { method: "DELETE" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error || "无法关闭终端。");
      }
      finishClose(id);
      setCloseTargetId(null);
    } catch (error) {
      setTabs((current) => current.map((tab) => tab.id === id ? { ...tab, closing: false } : tab));
      setTerminalError(error instanceof Error ? error.message : "无法关闭终端。");
      setCloseTargetId(null);
    }
  };

  const finishClose = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (selectedId === id) selectTerminal(next[Math.min(index, next.length - 1)]?.id ?? null);
  };

  if (!writable) {
    const message = workspaceError || {
      LEASE_INVALID: "当前项目租约与此工作区不匹配，无法打开终端。",
      CONTAINER_CONFLICT: "检测到容器归属冲突，终端已暂停使用。",
      CONTAINER_NOT_RUNNING: "开发容器当前未运行，暂时无法打开终端。",
      WORKSPACE_NOT_RUNNING: "开发环境正在切换状态，暂时无法打开终端。",
    }[accessReason ?? "WORKSPACE_NOT_RUNNING"];
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center bg-primary-solid px-6 text-center font-mono text-sm text-secondary_on-brand">
        {message}
      </div>
    );
  }
  if (workspaceStatus !== "RUNNING") {
    return <div className="flex min-h-0 flex-1 items-center justify-center bg-primary-solid px-6 text-center font-mono text-sm text-secondary_on-brand">正在等待 Runner 启动开发容器...</div>;
  }

  const atLimit = tabs.length >= MAX_TERMINALS;
  const closeTarget = tabs.find((tab) => tab.id === closeTargetId) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-primary-solid">
      <Tabs
        selectedKey={selectedId ?? ""}
        onSelectionChange={(key) => selectTerminal(String(key))}
        className="flex h-12 shrink-0 items-stretch border-b border-secondary bg-secondary"
      >
        <TabList items={tabs} aria-label="终端标签" className="flex min-w-0 flex-1 items-end gap-1 overflow-x-auto px-2 pt-2">
          {(tab) => (
            <Tab
              id={tab.id}
              className={({ isSelected, isFocusVisible }) => cx(
                "group flex h-10 min-w-32 max-w-52 cursor-pointer items-center gap-2 rounded-t-md pl-3 pr-1.5 text-sm font-medium outline-hidden transition duration-100",
                isSelected ? "bg-primary text-primary" : "text-tertiary hover:bg-primary_hover hover:text-tertiary_hover",
                isFocusVisible && "ring-2 ring-brand ring-inset",
                tab.closing && "cursor-wait opacity-60",
              )}
            >
              {tab.kind === "agent"
                ? <CpuChip01 className="size-4 shrink-0 text-fg-brand-primary" />
                : <TerminalSquare className="size-4 shrink-0 text-fg-quaternary" />}
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              <Button
                size="xs"
                color="tertiary"
                iconLeading={XClose}
                aria-label={`关闭 ${tab.title}`}
                isDisabled={tab.closing}
                className="size-7 shrink-0 p-0"
                onPointerDown={(event) => event.stopPropagation()}
                onClick={(event) => {
                  event.stopPropagation();
                  setCloseTargetId(tab.id);
                }}
              />
            </Tab>
          )}
        </TabList>

        <div className="flex shrink-0 items-center gap-1 border-l border-secondary px-2">
          <Dropdown.Root>
            <Button size="xs" color="tertiary" iconLeading={Plus} aria-label={atLimit ? `最多同时打开 ${MAX_TERMINALS} 个终端` : "新建终端"} isDisabled={atLimit || pendingCreate} isLoading={pendingCreate} />
            <Dropdown.Popover className="w-56">
              <Dropdown.Menu>
                <Dropdown.Item label="临时终端" icon={TerminalSquare} onAction={() => void openTerminal("shell")} />
                <Dropdown.Item label="Codex Agent" icon={CpuChip01} onAction={() => void openTerminal("agent", "codex")} />
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown.Root>
        </div>
      </Tabs>

      <div className="relative min-h-0 flex-1">
        {terminalError && <div role="alert" className="absolute inset-x-0 top-0 z-10 border-b border-error_subtle bg-error-primary px-3 py-2 text-sm text-error-primary">{terminalError}</div>}
        {tabs.length === 0 ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-primary-solid px-6 text-center">
            <TerminalSquare className="size-7 text-fg-quaternary" />
            <p className="mt-3 text-sm font-semibold text-primary_on-brand">尚未打开终端</p>
            <p className="mt-1 max-w-md text-sm text-tertiary_on-brand">临时终端适合执行 Shell 命令；Codex 会保留独立的 Agent 会话。</p>
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              <Button color="secondary" iconLeading={TerminalSquare} isDisabled={pendingCreate} onPress={() => void openTerminal("shell")}>临时终端</Button>
              <Button iconLeading={CpuChip01} isDisabled={pendingCreate} onPress={() => void openTerminal("agent", "codex")}>Codex Agent</Button>
            </div>
          </div>
        ) : tabs.map((tab) => (
          <div
            key={tab.id}
            id={`terminal-panel-${tab.id}`}
            role="tabpanel"
            aria-label={tab.title}
            className={cx("absolute inset-0", tab.id !== selectedId && "hidden")}
          >
            <TerminalCanvas
              workspaceId={workspaceId}
              terminalId={tab.id}
              kind={tab.kind}
              agent={tab.agent}
              isActive={tab.id === selectedId}
              closeRequested={tab.closing}
              onExit={() => finishClose(tab.id)}
            />
          </div>
        ))}
      </div>
      <TerminalCloseDialog
        isOpen={closeTarget !== null}
        isClosing={closeTarget?.closing ?? false}
        kind={closeTarget?.kind ?? "shell"}
        title={closeTarget?.title ?? "终端"}
        onCancel={() => setCloseTargetId(null)}
        onConfirm={() => { if (closeTarget) void requestClose(closeTarget.id); }}
      />
    </div>
  );
}
