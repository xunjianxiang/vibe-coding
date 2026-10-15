"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Container as ContainerIcon, Power01 } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import { isAbnormalContainerExit } from "@/lib/container-issue";
import type { ContainerInventoryEntry } from "@/lib/container-inventory";

type ContainerIssue = ContainerInventoryEntry & {
  projectKey: string | null;
};

const anomalyLabels = {
  ORPHAN: "孤儿容器",
  PROJECT_CONFLICT: "项目冲突",
  OWNERSHIP_CONFLICT: "归属冲突",
} as const;

function issueLabels(container: ContainerInventoryEntry) {
  const labels: string[] = [];
  if (container.anomaly) labels.push(anomalyLabels[container.anomaly]);
  if (isAbnormalContainerExit(container)) labels.push(container.oomKilled ? "内存溢出" : "异常退出");
  return labels;
}

function formatFinishedAt(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(date);
}

function OrphanContainerCloseDialog({
  container,
  isClosing,
  onCancel,
  onConfirm,
}: {
  container: ContainerIssue | null;
  isClosing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalOverlay
      isOpen={container !== null}
      isDismissable={!isClosing}
      onOpenChange={(open) => { if (!open && !isClosing) onCancel(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4 py-8 data-entering:animate-in data-entering:fade-in data-exiting:animate-out data-exiting:fade-out"
    >
      <Modal className="w-full max-w-md outline-hidden data-entering:animate-in data-entering:zoom-in-95 data-exiting:animate-out data-exiting:zoom-out-95">
        <Dialog role="alertdialog" className="rounded-lg bg-primary p-6 shadow-xl ring-1 ring-secondary outline-hidden">
          <div className="flex size-10 items-center justify-center rounded-full bg-error-primary">
            <AlertTriangle className="size-5 text-fg-error-primary" />
          </div>
          <Heading slot="title" className="mt-4 break-words text-lg font-semibold text-primary">
            关闭孤儿容器？
          </Heading>
          <p className="mt-2 text-sm text-tertiary">
            将停止并删除容器“{container?.name ?? container?.id.slice(0, 12)}”。此操作不可撤销，但不会删除项目源码。
          </p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button color="secondary" isDisabled={isClosing} onPress={onCancel}>取消</Button>
            <Button color="primary-destructive" isLoading={isClosing} showTextWhileLoading onPress={onConfirm}>
              关闭并释放
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}

export function ContainerIssues({ containers }: { containers: ContainerIssue[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ContainerIssue | null>(null);
  const [isClosing, setIsClosing] = useState(false);
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});

  const visibleContainers = containers.filter((container) => !removedIds.has(container.id));
  if (visibleContainers.length === 0) return null;

  const closeContainer = async () => {
    if (!selected) return;
    const containerId = selected.id;
    setIsClosing(true);
    setErrors((current) => ({ ...current, [containerId]: "" }));
    try {
      const response = await fetch(`/api/containers/${encodeURIComponent(containerId)}/cleanup`, { method: "POST" });
      if (!response.ok) throw new Error("暂时无法释放此容器，请稍后重试。");
      setRemovedIds((current) => new Set(current).add(containerId));
      setSelected(null);
      router.refresh();
    } catch (error) {
      setErrors((current) => ({
        ...current,
        [containerId]: error instanceof Error ? error.message : "暂时无法释放此容器，请稍后重试。",
      }));
      setSelected(null);
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <>
      <section className="mb-6 overflow-hidden rounded-lg bg-primary shadow-xs ring-1 ring-secondary" aria-labelledby="container-issues-title">
        <header className="flex items-start gap-3 border-b border-secondary px-4 py-4 md:px-5">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-warning-primary text-fg-warning-secondary">
            <AlertTriangle className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="container-issues-title" className="text-md font-semibold text-primary">容器</h2>
              <span className="rounded-md bg-utility-yellow-50 px-1.5 py-0.5 text-xs font-medium text-utility-yellow-700 ring-1 ring-inset ring-utility-yellow-200">
                {visibleContainers.length} 个需要处理
              </span>
            </div>
            <p className="mt-0.5 text-sm text-tertiary">仅显示孤儿、冲突或非预期退出的受管容器。</p>
          </div>
        </header>

        <div className="divide-y divide-secondary">
          {visibleContainers.map((container) => {
            const finishedAt = formatFinishedAt(container.finishedAt);
            return (
              <div key={container.id} className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1.2fr)_minmax(16rem,1fr)_6rem] md:items-center md:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-md bg-secondary text-fg-tertiary">
                    <ContainerIcon className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-primary">{container.name ?? `容器 ${container.id.slice(0, 12)}`}</p>
                    <p className="mt-0.5 truncate font-mono text-xs text-quaternary">{container.id.slice(0, 12)}</p>
                  </div>
                </div>

                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1">
                    {issueLabels(container).map((label) => (
                      <span key={label} className="rounded-md bg-utility-red-50 px-1.5 py-0.5 text-xs font-medium text-utility-red-700 ring-1 ring-inset ring-utility-red-200">
                        {label}
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 truncate text-xs text-quaternary">
                    {container.projectKey && <span className="text-tertiary">{container.projectKey} · </span>}
                    {container.running ? "仍在运行" : finishedAt ? `${finishedAt} 停止` : "已停止"}
                  </p>
                  {errors[container.id] && <p className="mt-1 text-xs text-error-primary" role="alert">{errors[container.id]}</p>}
                </div>

                <div className="flex items-center md:justify-end">
                  {container.anomaly === "ORPHAN" && (
                    <Button
                      size="xs"
                      color="secondary-destructive"
                      iconLeading={Power01}
                      onPress={() => setSelected(container)}
                    >
                      关闭
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <OrphanContainerCloseDialog
        container={selected}
        isClosing={isClosing}
        onCancel={() => setSelected(null)}
        onConfirm={() => void closeContainer()}
      />
    </>
  );
}
