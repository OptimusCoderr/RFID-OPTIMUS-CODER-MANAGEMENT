import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { io, Socket } from "socket.io-client";
import { useAuth } from "./AuthContext";
import { getAccessToken } from "@/lib/api";

interface SocketContextValue {
  socket: Socket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<Socket | null>(null);
  const [socket, setSocket] = useState<Socket | null>(null);

  // Keyed on user?.id, not user itself — AuthContext.refreshUser() always
  // sets a brand-new user object on every call (e.g. after a profile-name
  // save), even when the logically-signed-in user hasn't changed. Keying on
  // the whole object would tear down and reconnect the socket on every such
  // refresh, killing any hardware command in flight on Live Encode and
  // forcing every socket consumer (notifications, Attendance, Cards) to
  // resubscribe for no reason.
  const userId = user?.id;

  useEffect(() => {
    if (!userId) {
      socketRef.current?.disconnect();
      socketRef.current = null;
      setSocket(null);
      setConnected(false);
      return;
    }

    const token = getAccessToken();
    const instance = io("/dashboard", {
      auth: { token },
      transports: ["websocket", "polling"],
    });

    instance.on("connect", () => setConnected(true));
    instance.on("disconnect", () => setConnected(false));

    socketRef.current = instance;
    setSocket(instance);

    return () => {
      instance.disconnect();
    };
  }, [userId]);

  const value = useMemo(() => ({ socket, connected }), [socket, connected]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

export function useSocket() {
  return useContext(SocketContext);
}
