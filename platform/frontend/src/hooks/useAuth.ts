import { useCallback, useState } from "react";
import api from "@/api/client";

export function useAuth() {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("access_token"));

  const login = useCallback(async (email: string, password: string) => {
    const { data } = await api.post("/auth/token/", { email, password });
    localStorage.setItem("access_token", data.access);
    localStorage.setItem("refresh_token", data.refresh);
    setToken(data.access);
  }, []);

  const logout = useCallback(() => {
    localStorage.clear();
    setToken(null);
  }, []);

  return { token, login, logout };
}
