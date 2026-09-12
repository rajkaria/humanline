// Minimal MCP (streamable HTTP) client for the World developer portal. Never prints the key.
const KEY = (await Bun.file(new URL("../.secrets.env", import.meta.url)).text()).match(/WORLD_DEV_PORTAL_KEY=(\S+)/)?.[1];
if (!KEY) throw new Error("no key");
const URL_ = "https://developer.world.org/api/mcp";
let sessionId: string | undefined;
async function rpc(method: string, params: any = {}, id = 1) {
  const res = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${KEY}`, ...(sessionId ? { "mcp-session-id": sessionId } : {}) }, body: JSON.stringify({ jsonrpc: "2.0", id, method, params }) });
  sessionId = res.headers.get("mcp-session-id") ?? sessionId;
  const text = await res.text();
  if (!res.ok) return { status: res.status, text: text.slice(0, 500) };
  // SSE or JSON
  const lines = text.split("\n").filter(l => l.startsWith("data:")).map(l => l.slice(5).trim());
  const payload = lines.length ? lines.map(l => { try { return JSON.parse(l); } catch { return l; } }) : (() => { try { return JSON.parse(text); } catch { return text; } })();
  return payload;
}
const [cmd = "list", ...rest] = process.argv.slice(2);
const init = await rpc("initialize", { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "humanline", version: "0.1" } }, 0);
if (cmd === "init") console.log(JSON.stringify(init, null, 1).slice(0, 1500));
await rpc("notifications/initialized", {}, 1).catch(() => {});
if (cmd === "list") { const r = await rpc("tools/list", {}, 2); console.log(JSON.stringify(r, null, 1).slice(0, 20000)); }
if (cmd === "call") { const [name, argsJson = "{}"] = rest; const r = await rpc("tools/call", { name, arguments: JSON.parse(argsJson) }, 3); console.log(JSON.stringify(r, null, 1).slice(0, 20000)); }
