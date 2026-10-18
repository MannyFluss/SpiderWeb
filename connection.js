export function normalizeNode(value) {
  const u = new URL(value);
  if (
    u.username ||
    u.password ||
    u.search ||
    u.hash ||
    (u.pathname !== "/" && u.pathname !== "")
  )
    throw Error("Use the Mac’s address without a path, password, or query.");
  if (
    u.protocol !== "https:" &&
    !(
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
  )
    throw Error("Use HTTPS for a Mac on your network.");
  return u.origin;
}

export function clientInfo(n) {
  const ua = n.userAgent || "";
  const tablet =
    /iPad/.test(ua) ||
    (/Mac/.test(ua) && n.maxTouchPoints > 1) ||
    (/Android/.test(ua) && !/Mobile/.test(ua));
  const phone = !tablet && /iPhone|Android|Mobile/.test(ua);
  return {
    kind: tablet
      ? "tablet"
      : phone
        ? "phone"
        : /Mac|Windows|Linux/.test(ua)
          ? "desktop"
          : "browser",
    platform:
      /iPhone|iPad/.test(ua) || (tablet && /Mac/.test(ua))
        ? "iOS"
        : /Android/.test(ua)
          ? "Android"
          : /Mac/.test(ua)
            ? "macOS"
            : /Windows/.test(ua)
              ? "Windows"
              : /Linux/.test(ua)
                ? "Linux"
                : "",
    browser: /Edg\//.test(ua)
      ? "Edge"
      : /Firefox|FxiOS/.test(ua)
        ? "Firefox"
        : /Chrome|CriOS/.test(ua)
          ? "Chrome"
          : /Safari/.test(ua)
            ? "Safari"
            : "Browser",
  };
}

export class NodeRequestError extends Error {
  constructor(message, { kind, status } = {}) {
    super(message);
    this.kind = kind;
    this.status = status;
  }
}

export async function requestNode(
  node,
  path,
  {
    hosted = false,
    access = false,
    token,
    body,
    method,
    timeoutMs = 8000,
    fetchImpl = globalThis.fetch,
  } = {},
) {
  if (!node)
    throw new NodeRequestError(
      "Enter the Mac’s HTTPS address or scan a pairing QR from Spider.",
      { kind: "address" },
    );
  const headers = body
    ? { "Content-Type": "application/json", "X-Spider-Request": "1" }
    : {};
  if (token) headers.Authorization = "Spider " + token;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(node + path, {
      method: method || (body ? "POST" : "GET"),
      credentials: hosted ? "include" : "same-origin",
      ...((hosted || access) ? {redirect: "manual"} : {}),
      headers,
      body: body ? JSON.stringify(body) : undefined,
      cache: "no-store",
      signal: controller.signal,
    });
    if (response.type === "opaqueredirect" || (response.status >= 300 && response.status < 400))
      throw new NodeRequestError("Sign into Cloudflare Access to continue.", {kind:"access",status:response.status || undefined});
    let result;
    try {
      result = await response.json();
    } catch (error) {
      if (controller.signal.aborted) throw error;
      if (access && [200,401,403].includes(response.status))
        throw new NodeRequestError("Sign into Cloudflare Access to continue.", {kind:"access",status:response.status});
      throw new NodeRequestError(
        `The address answered with an unreadable response (HTTP ${response.status}). Check that it is the Spider Mac address.`,
        { kind: "response", status: response.status },
      );
    }
    if (!response.ok)
      throw new NodeRequestError(
        result.error || `Spider returned HTTP ${response.status}`,
        { kind: "server", status: response.status },
      );
    return result;
  } catch (error) {
    if (error instanceof NodeRequestError) throw error;
    if (access)
      throw new NodeRequestError("Cloudflare sign-in or the Mac connection could not be confirmed. Sign in, then check that the Mac is awake and online.", {kind:"access-or-network"});
    throw new NodeRequestError(
      controller.signal.aborted
        ? "The request to the Mac timed out."
        : "The browser could not connect to the Mac.",
      { kind: controller.signal.aborted ? "timeout" : "network" },
    );
  } finally {
    clearTimeout(timer);
  }
}

export function connectionMessage(error) {
  if (error.kind === "access" || error.kind === "access-or-network") return error.message;
  if (error.status === 401)
    return "The Mac is reachable. Enter a fresh pairing code to connect this browser.";
  if (error.kind === "server")
    return `Spider replied with HTTP ${error.status}: ${error.message} Open Check connection for details.`;
  if (error.kind === "response" || error.kind === "address")
    return error.message;
  return `${error.message || "Could not reach the Mac."} Use Check connection to test the address and see the iPhone trust steps.`;
}

export async function checkConnection(node, options = {}) {
  const report = {
    checkedAt: new Date().toISOString(),
    node: "",
    status: "checking",
    checks: [],
  };
  const add = (name, status, detail) =>
    report.checks.push({ name, status, detail });
  try {
    report.node = normalizeNode(node);
    add("Mac address", "pass", report.node);
  } catch (error) {
    add("Mac address", "fail", error.message);
    return {
      ...report,
      status: "address",
      message: "Check the Mac address printed by spider pair.",
    };
  }
  const secure = report.node.startsWith("https:");
  try {
    const health = await requestNode(
      report.node,
      "/health?check=" + encodeURIComponent(report.checkedAt),
      options,
    );
    if (health.app !== "spider") {
      add(
        "Spider service",
        "fail",
        "This address replied, but it did not identify itself as Spider.",
      );
      return {
        ...report,
        status: "wrong-service",
        message: "Use the Mac address printed by spider pair.",
      };
    }
    add(
      "Network connection",
      "pass",
      `Reached Spider ${health.version || ""}.`.trim(),
    );
    add(
      "Certificate trust",
      secure ? "pass" : "info",
      secure
        ? "This browser accepted the Mac’s HTTPS certificate for this request."
        : "This is local HTTP on the Mac. No TLS certificate is used.",
    );
  } catch (error) {
    add(
      "Network connection",
      "fail",
      error.status ? `HTTP ${error.status}: ${error.message}` : error.message,
    );
    add(
      "Certificate trust",
      "unknown",
      "Not confirmed. A blocked request does not reveal whether the cause is Wi-Fi, certificate trust, or browser local-network permission.",
    );
    return {
      ...report,
      status: error.kind === "access" ? "access" : "blocked",
      httpStatus: error.status,
      message: options.access ? connectionMessage(error) : "The browser could not confirm a connection. Follow the checks below.",
    };
  }
  try {
    await requestNode(report.node, "/api/state", options);
    add(
      "Workspace access",
      "pass",
      "This browser is paired and can read the workspace.",
    );
    return {
      ...report,
      status: "ready",
      message:
        "Connected. The address, browser connection, and workspace access work.",
    };
  } catch (error) {
    if (error.status === 401) {
      add(
        "Workspace access",
        "info",
        "The Mac answered HTTP 401: this browser needs pairing.",
      );
      return {
        ...report,
        status: "pairing",
        httpStatus: 401,
        message: "Your Mac is reachable. Enter a fresh pairing code.",
      };
    }
    add(
      "Workspace access",
      "fail",
      error.status ? `HTTP ${error.status}: ${error.message}` : error.message,
    );
    return {
      ...report,
      status: error.kind === "server" ? "server-rejected" : "blocked",
      httpStatus: error.status,
      message:
        error.kind === "server"
          ? `The Mac is reachable, but its API rejected the request (HTTP ${error.status}): ${error.message}`
          : "The Mac answered the connection test, but the workspace request failed.",
    };
  }
}
