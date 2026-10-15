"use client";

import { useEffect, useRef, useState } from "react";
import { FitAddon } from "@xterm/addon-fit";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { Terminal } from "@xterm/xterm";
import { RefreshCw01 } from "@untitledui/icons";
import { Button } from "@/components/base/buttons/button";
import type { TerminalAgent, TerminalKind } from "@/lib/terminal-ticket";

type ConnectionState = "connecting" | "connected" | "error";

export function TerminalCanvas({
  workspaceId,
  terminalId,
  kind,
  agent,
  isActive,
  closeRequested,
  onExit,
}: {
  workspaceId: string;
  terminalId: string;
  kind: TerminalKind;
  agent?: TerminalAgent;
  isActive: boolean;
  closeRequested: boolean;
  onExit: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const closeRequestedRef = useRef(closeRequested);
  const onExitRef = useRef(onExit);
  const activeRef = useRef(isActive);
  const [state, setState] = useState<ConnectionState>("connecting");
  const [message, setMessage] = useState(kind === "agent" ? "正在连接 Codex Agent..." : "正在连接临时终端...");
  const [closing, setClosing] = useState(false);
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  useEffect(() => {
    onExitRef.current = onExit;
  }, [onExit]);

  useEffect(() => {
    activeRef.current = isActive;
    if (!isActive) return;
    const frame = window.requestAnimationFrame(() => {
      fitRef.current?.fit();
      terminalRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isActive]);

  useEffect(() => {
    closeRequestedRef.current = closeRequested;
    if (!closeRequested) return;
    const socket = socketRef.current;
    if (!socket || socket.readyState === WebSocket.CLOSED) {
      onExitRef.current();
      return;
    }
    setClosing(true);
    setMessage("正在关闭终端...");
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "close" }));
  }, [closeRequested]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    let socket: WebSocket | null = null;
    const terminal = new Terminal({
      allowProposedApi: true,
      cursorBlink: true,
      cursorInactiveStyle: "bar",
      cursorStyle: "bar",
      cursorWidth: 1,
      convertEol: false,
      fontFamily: "var(--font-roboto-mono), ui-monospace, monospace",
      fontSize: 14,
      fontWeight: "400",
      fontWeightBold: "600",
      lineHeight: 1.25,
      minimumContrastRatio: 4.5,
      scrollback: 5_000,
      theme: {
        background: "#0b0f14",
        foreground: "#e6edf3",
        cursor: "#38bdf8",
        cursorAccent: "#071018",
        selectionBackground: "#075985",
        selectionForeground: "#f8fafc",
        selectionInactiveBackground: "#164e63",
        scrollbarSliderBackground: "#64748b66",
        scrollbarSliderHoverBackground: "#94a3b899",
        scrollbarSliderActiveBackground: "#cbd5e1b3",
        black: "#6b7c93",
        red: "#fb7185",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#94a3b8",
        brightRed: "#fda4af",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
    });
    const fit = new FitAddon();
    terminalRef.current = terminal;
    fitRef.current = fit;
    terminal.loadAddon(fit);
    terminal.loadAddon(new Unicode11Addon());
    terminal.unicode.activeVersion = "11";
    terminal.open(container);

    const resize = new ResizeObserver(() => {
      if (!activeRef.current) return;
      fit.fit();
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      }
    });
    resize.observe(container);

    void fetch(`/api/workspaces/${workspaceId}/terminal-ticket`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ terminalId }),
    })
      .then(async (response) => {
        const body = await response.json() as { ticket?: string; error?: string };
        if (!response.ok || !body.ticket) throw new Error(body.error || "无法获取终端票据。");
        if (disposed) return;
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${window.location.host}/ws/terminal?ticket=${encodeURIComponent(body.ticket)}`);
        socketRef.current = socket;
        socket.binaryType = "arraybuffer";
        socket.addEventListener("open", () => {
          setState("connected");
          setMessage("已连接");
          fit.fit();
          socket?.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
          if (closeRequestedRef.current) {
            setClosing(true);
            setMessage("正在关闭终端...");
            socket?.send(JSON.stringify({ type: "close" }));
          } else if (activeRef.current) {
            terminal.focus();
          }
        });
        socket.addEventListener("message", (event) => {
          if (event.data instanceof ArrayBuffer) {
            terminal.write(new Uint8Array(event.data));
            return;
          }
          if (typeof event.data === "string") {
            try {
              const control = JSON.parse(event.data) as { type?: string };
              if (control.type === "closing") {
                setClosing(true);
                setMessage("正在关闭终端...");
              }
            } catch {
              // Terminal output is always sent as binary frames.
            }
          }
        });
        socket.addEventListener("close", (event) => {
          if (disposed) return;
          socketRef.current = null;
          if (event.code === 1000) {
            onExitRef.current();
            return;
          }
          setState("error");
          setMessage(event.reason || "终端连接已断开");
        });
        socket.addEventListener("error", () => {
          if (!disposed) {
            setState("error");
            setMessage("无法连接 Terminal Gateway");
          }
        });
      })
      .catch((error) => {
        if (!disposed) {
          setState("error");
          setMessage(error instanceof Error ? error.message : "终端连接失败");
        }
      });

    const input = terminal.onData((data) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(new TextEncoder().encode(data));
    });

    return () => {
      disposed = true;
      input.dispose();
      resize.disconnect();
      socket?.close();
      socketRef.current = null;
      terminalRef.current = null;
      fitRef.current = null;
      terminal.dispose();
    };
  }, [agent, kind, reconnectAttempt, terminalId, workspaceId]);

  return (
    <div className="relative h-full min-h-0 bg-primary-solid" aria-hidden={!isActive}>
      <div ref={containerRef} className="absolute inset-0" />
      {state !== "connected" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-primary-solid/90 px-6 text-center font-mono text-sm text-secondary_on-brand">
          <span>{message}</span>
          {state === "error" && (
            <Button size="sm" color="secondary" iconLeading={RefreshCw01} onPress={() => {
              setState("connecting");
              setMessage(kind === "agent" ? "正在恢复 Codex Agent..." : "正在重建临时终端...");
              setReconnectAttempt((current) => current + 1);
            }}>
              重新连接
            </Button>
          )}
        </div>
      )}
      {closing && state === "connected" && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-primary-solid/90 px-6 text-center font-mono text-sm text-secondary_on-brand">
          {message}
        </div>
      )}
    </div>
  );
}
