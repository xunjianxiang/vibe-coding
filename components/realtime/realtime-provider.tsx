"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { RealtimeConnectionState, RealtimeMessage } from "@/lib/realtime";

type Listener = (message: RealtimeMessage) => void;
type RealtimeContextValue = {
  state: RealtimeConnectionState;
  subscribe: (listener: Listener) => () => void;
};

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RealtimeConnectionState>("disconnected");
  const listenersRef = useRef(new Set<Listener>());

  const subscribe = useCallback((listener: Listener) => {
    listenersRef.current.add(listener);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  useEffect(() => {
    let disposed = false;
    let socket: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let retryMs = 1_000;

    const scheduleReconnect = () => {
      if (disposed || retryTimer) return;
      setState("reconnecting");
      const jitter = Math.floor(Math.random() * Math.min(retryMs, 1_000));
      retryTimer = setTimeout(() => {
        retryTimer = null;
        void connect();
      }, retryMs + jitter);
      retryMs = Math.min(retryMs * 2, 30_000);
    };

    const connect = async () => {
      if (disposed || socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
      try {
        const response = await fetch("/api/realtime-ticket", { method: "POST" });
        if (response.status === 401) {
          setState("disconnected");
          return;
        }
        if (!response.ok) throw new Error("Unable to create realtime ticket.");
        const { ticket } = await response.json() as { ticket: string };
        const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
        socket = new WebSocket(`${protocol}//${window.location.host}/ws/events?ticket=${encodeURIComponent(ticket)}`);
        socket.onopen = () => {
          retryMs = 1_000;
          setState("connected");
        };
        socket.onmessage = (event) => {
          try {
            const message = JSON.parse(String(event.data)) as RealtimeMessage | { type?: string };
            if (message.type === "hello") return;
            for (const listener of listenersRef.current) listener(message as RealtimeMessage);
          } catch { /* Ignore malformed messages and keep the connection alive. */ }
        };
        socket.onerror = () => socket?.close();
        socket.onclose = () => {
          socket = null;
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };

    const resume = () => {
      if (document.visibilityState === "visible" && (!socket || socket.readyState > WebSocket.OPEN)) {
        if (retryTimer) clearTimeout(retryTimer);
        retryTimer = null;
        retryMs = 1_000;
        void connect();
      }
    };

    void connect();
    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    return () => {
      disposed = true;
      if (retryTimer) clearTimeout(retryTimer);
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
      socket?.close(1000, "Page closed.");
    };
  }, []);

  const value = useMemo(() => ({ state, subscribe }), [state, subscribe]);
  return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  const context = useContext(RealtimeContext);
  if (!context) throw new Error("useRealtime must be used inside RealtimeProvider.");
  return context;
}
