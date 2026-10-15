"use client";

import { AlertTriangle } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "@/components/base/buttons/button";
import type { TerminalKind } from "@/lib/terminal-ticket";

export function TerminalCloseDialog({
  isOpen,
  isClosing,
  kind,
  title,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  isClosing: boolean;
  kind: TerminalKind;
  title: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const description = kind === "agent"
    ? "这会结束当前 Codex 进程并关闭此标签。若还需要继续当前会话，请取消并保持终端打开。"
    : "这会结束当前 Shell 及其中运行的命令。已写入工作区的文件不会被删除。";

  return (
    <ModalOverlay
      isOpen={isOpen}
      isDismissable={!isClosing}
      onOpenChange={(open) => { if (!open && !isClosing) onCancel(); }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay px-4 py-8 data-entering:animate-in data-entering:fade-in data-exiting:animate-out data-exiting:fade-out"
    >
      <Modal className="w-full max-w-md outline-hidden data-entering:animate-in data-entering:zoom-in-95 data-exiting:animate-out data-exiting:zoom-out-95">
        <Dialog role="alertdialog" className="rounded-lg bg-primary p-6 shadow-xl ring-1 ring-secondary outline-hidden">
          <div className="flex size-10 items-center justify-center rounded-full bg-error-primary">
            <AlertTriangle className="size-5 text-fg-error-primary" />
          </div>
          <Heading slot="title" className="mt-4 text-lg font-semibold text-primary">
            关闭{title}？
          </Heading>
          <p className="mt-2 text-sm text-tertiary">{description}</p>
          <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Button color="secondary" isDisabled={isClosing} onPress={onCancel}>取消</Button>
            <Button color="primary-destructive" isLoading={isClosing} showTextWhileLoading onPress={onConfirm}>
              关闭终端
            </Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );
}
