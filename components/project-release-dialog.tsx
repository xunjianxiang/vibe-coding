"use client";

import { AlertTriangle } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";

export function ProjectReleaseDialog({
  isOpen,
  isReleasing,
  projectKey,
  hasWorkspace,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  isReleasing: boolean;
  projectKey: string;
  hasWorkspace: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ModalOverlay
      isOpen={isOpen}
      isDismissable={!isReleasing}
      onOpenChange={(open) => { if (!open && !isReleasing) onCancel(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4 py-8 data-entering:animate-in data-entering:fade-in data-exiting:animate-out data-exiting:fade-out"
    >
      <Modal className="w-full max-w-md outline-hidden data-entering:animate-in data-entering:zoom-in-95 data-exiting:animate-out data-exiting:zoom-out-95">
        <Dialog role="alertdialog" className="rounded-lg bg-primary p-6 shadow-xl ring-1 ring-secondary outline-hidden">
          <div className="flex size-10 items-center justify-center rounded-full bg-error-primary">
            <AlertTriangle className="size-5 text-fg-error-primary" />
          </div>
          <Heading slot="title" className="mt-4 break-words text-lg font-semibold text-primary">
            释放“{projectKey}”？
          </Heading>
          {hasWorkspace ? (
            <div className="mt-2 text-sm text-tertiary">
              <p>释放后，此 Workspace 及其中的 Codex 会话无法恢复：</p>
              <ul className="mt-3 list-disc space-y-1 pl-5">
                <li>关闭所有终端和 Codex 进程</li>
                <li>删除容器、数据卷（Volume）和网络</li>
                <li>解除项目领取关系，其他用户可以重新领取</li>
              </ul>
              <p className="mt-3 font-medium text-primary">项目源码和未提交修改会保留。</p>
            </div>
          ) : (
            <p className="mt-2 text-sm text-tertiary">
              这会解除你的项目领取关系，其他用户可以重新领取。当前没有 Workspace 资源需要删除，项目源码不会改变。
            </p>
          )}
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button color="secondary" isDisabled={isReleasing} onPress={onCancel}>取消</Button>
            <Button color="primary-destructive" isLoading={isReleasing} showTextWhileLoading onPress={onConfirm}>
              释放项目
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
