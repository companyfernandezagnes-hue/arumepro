export async function proxyFetch(url: string, options: { method?: string; body?: any; headers?: any } = {}) {
  const response = await fetch("/api/proxy", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      url,
      method: options.method || "POST",
      body: options.body,
      headers: options.headers,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(errorData.error || `HTTP ${response.status}`);
  }

  return response.json();
}
