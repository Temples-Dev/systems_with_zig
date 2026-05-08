export interface StreamEvent {
  type: "stdout" | "stderr" | "done" | "error";
  text?: string;
  exit_code?: number;
  duration_ms?: number;
}

export async function streamRun(
  body: { files: Array<{ path: string; content: string }>; mode: string },
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal
): Promise<void> {
  const token = localStorage.getItem("access_token");
  const resp = await fetch("/api/execution/stream/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!resp.ok || !resp.body) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE events are separated by double newline
      const parts = buffer.split("\n\n");
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        for (const line of part.split("\n")) {
          if (line.startsWith("data: ")) {
            try {
              onEvent(JSON.parse(line.slice(6)) as StreamEvent);
            } catch {
              // ignore malformed events
            }
          }
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
