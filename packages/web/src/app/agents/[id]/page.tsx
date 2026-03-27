"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";

interface Agent {
  id: string;
  name: string;
  llmProvider: string;
  llmModel: string | null;
  status: string;
  containerId: string | null;
  skills: string;
}

type Tab = "soul" | "cron" | "chat";

export default function AgentDetail() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [agent, setAgent] = useState<Agent | null>(null);
  const [tab, setTab] = useState<Tab>("soul");
  const [soul, setSoul] = useState("");
  const [cron, setCron] = useState("");
  const [saving, setSaving] = useState(false);
  const [chatInput, setChatInput] = useState("");
  const [chatMessages, setChatMessages] = useState<{ role: string; text: string }[]>([]);
  const [chatLoading, setChatLoading] = useState(false);

  const fetchAgent = useCallback(async () => {
    const res = await fetch("/api/agents");
    const agents = await res.json();
    const found = agents.find((a: Agent) => a.id === id);
    setAgent(found || null);
  }, [id]);

  const getAgentPort = useCallback(async (): Promise<number | null> => {
    if (!agent?.containerId) return null;
    try {
      const res = await fetch(`/api/agents/${id}/port`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.port;
    } catch {
      return null;
    }
  }, [agent, id]);

  const loadFiles = useCallback(async () => {
    const port = await getAgentPort();
    if (!port) return;
    try {
      const [soulRes, cronRes] = await Promise.all([
        fetch(`/api/agents/${id}/proxy?path=/soul`),
        fetch(`/api/agents/${id}/proxy?path=/cron`),
      ]);
      if (soulRes.ok) {
        const data = await soulRes.json();
        setSoul(data.content || "");
      }
      if (cronRes.ok) {
        const data = await cronRes.json();
        setCron(data.content || "");
      }
    } catch {
      // Agent might not be running
    }
  }, [id, getAgentPort]);

  useEffect(() => {
    fetchAgent();
  }, [fetchAgent]);

  useEffect(() => {
    if (agent?.status === "running") loadFiles();
  }, [agent, loadFiles]);

  const saveFile = async (type: "soul" | "cron") => {
    setSaving(true);
    const content = type === "soul" ? soul : cron;
    await fetch(`/api/agents/${id}/proxy?path=/${type}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
    setSaving(false);
  };

  const sendChat = async () => {
    if (!chatInput.trim()) return;
    const msg = chatInput;
    setChatInput("");
    setChatMessages((prev) => [...prev, { role: "user", text: msg }]);
    setChatLoading(true);

    try {
      const res = await fetch(`/api/agents/${id}/proxy?path=/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: msg }),
      });
      if (res.ok) {
        const data = await res.json();
        setChatMessages((prev) => [...prev, { role: "assistant", text: data.reply }]);
      } else {
        setChatMessages((prev) => [...prev, { role: "assistant", text: "Error: failed to get response" }]);
      }
    } catch {
      setChatMessages((prev) => [...prev, { role: "assistant", text: "Error: agent not reachable" }]);
    }
    setChatLoading(false);
  };

  if (!agent) {
    return <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem" }}>Loading...</main>;
  }

  const isRunning = agent.status === "running";
  const tabStyle = (t: Tab) => ({
    padding: "0.5rem 1rem",
    border: "none",
    borderBottom: tab === t ? "2px solid #2563eb" : "2px solid transparent",
    background: "none",
    cursor: "pointer",
    fontSize: "0.875rem",
    fontWeight: tab === t ? 600 : 400,
    color: tab === t ? "#2563eb" : "#6b7280",
  });

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem", fontFamily: "system-ui" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1rem", marginBottom: "1.5rem" }}>
        <button onClick={() => router.push("/")} style={{ background: "none", border: "none", cursor: "pointer", fontSize: "1rem" }}>
          &larr; Back
        </button>
        <h1 style={{ fontSize: "1.25rem", margin: 0 }}>{agent.name}</h1>
        <span style={{
          padding: "0.125rem 0.5rem", borderRadius: "9999px", fontSize: "0.75rem", fontWeight: 500,
          background: isRunning ? "#22c55e20" : "#f59e0b20",
          color: isRunning ? "#22c55e" : "#f59e0b",
        }}>
          {agent.status}
        </span>
        <span style={{ color: "#9ca3af", fontSize: "0.75rem" }}>{agent.llmProvider}</span>
      </div>

      {!isRunning && (
        <p style={{ color: "#ef4444", background: "#fef2f2", padding: "0.75rem", borderRadius: "6px", fontSize: "0.875rem" }}>
          Agent is not running. Start it first to edit SOUL.md, CRON.md, or chat.
        </p>
      )}

      <div style={{ borderBottom: "1px solid #e5e7eb", marginBottom: "1rem" }}>
        <button onClick={() => setTab("soul")} style={tabStyle("soul")}>SOUL.md</button>
        <button onClick={() => setTab("cron")} style={tabStyle("cron")}>CRON.md</button>
        <button onClick={() => setTab("chat")} style={tabStyle("chat")}>Chat</button>
      </div>

      {tab === "soul" && (
        <div>
          <p style={{ color: "#6b7280", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
            Define the agent&apos;s personality and identity. Use {"{{AGENT_NAME}}"} as a placeholder.
          </p>
          <textarea
            value={soul}
            onChange={(e) => setSoul(e.target.value)}
            disabled={!isRunning}
            placeholder={`You are {{AGENT_NAME}}, a friendly AI assistant specialized in...\n\nYour personality:\n- Concise and helpful\n- Expert in...\n\nRules:\n- Always respond in Korean\n- Never share sensitive data`}
            style={{
              width: "100%", height: 300, padding: "0.75rem", borderRadius: "6px",
              border: "1px solid #d1d5db", fontFamily: "monospace", fontSize: "0.8rem",
              resize: "vertical",
            }}
          />
          <button
            onClick={() => saveFile("soul")}
            disabled={!isRunning || saving}
            style={{
              marginTop: "0.5rem", padding: "0.5rem 1rem", borderRadius: "6px",
              border: "none", background: "#2563eb", color: "white", cursor: "pointer",
              opacity: isRunning ? 1 : 0.5,
            }}
          >
            {saving ? "Saving..." : "Save SOUL.md"}
          </button>
        </div>
      )}

      {tab === "cron" && (
        <div>
          <p style={{ color: "#6b7280", fontSize: "0.8rem", marginBottom: "0.75rem" }}>
            Define recurring tasks. Format: <code># every &lt;interval&gt; — &lt;task&gt;</code>
            <br />Intervals: 1m, 5m, 15m, 30m, 1h, 6h, 12h, 24h
          </p>
          <textarea
            value={cron}
            onChange={(e) => setCron(e.target.value)}
            disabled={!isRunning}
            placeholder={`# every 30m — Check the latest AI news and summarize\n# every 6h — Generate a status report page at /p/status\n# every 24h — Review yesterday's activity and create a summary`}
            style={{
              width: "100%", height: 200, padding: "0.75rem", borderRadius: "6px",
              border: "1px solid #d1d5db", fontFamily: "monospace", fontSize: "0.8rem",
              resize: "vertical",
            }}
          />
          <button
            onClick={() => saveFile("cron")}
            disabled={!isRunning || saving}
            style={{
              marginTop: "0.5rem", padding: "0.5rem 1rem", borderRadius: "6px",
              border: "none", background: "#2563eb", color: "white", cursor: "pointer",
              opacity: isRunning ? 1 : 0.5,
            }}
          >
            {saving ? "Saving..." : "Save CRON.md"}
          </button>
        </div>
      )}

      {tab === "chat" && (
        <div>
          <div style={{
            height: 400, overflowY: "auto", border: "1px solid #e5e7eb", borderRadius: "6px",
            padding: "0.75rem", marginBottom: "0.5rem", background: "#fafafa",
          }}>
            {chatMessages.length === 0 && (
              <p style={{ color: "#9ca3af", textAlign: "center", marginTop: "8rem" }}>
                Send a message to chat with {agent.name}
              </p>
            )}
            {chatMessages.map((msg, i) => (
              <div key={i} style={{
                marginBottom: "0.75rem",
                textAlign: msg.role === "user" ? "right" : "left",
              }}>
                <div style={{
                  display: "inline-block", maxWidth: "80%", padding: "0.5rem 0.75rem",
                  borderRadius: "12px", fontSize: "0.875rem", whiteSpace: "pre-wrap",
                  background: msg.role === "user" ? "#2563eb" : "#e5e7eb",
                  color: msg.role === "user" ? "white" : "black",
                }}>
                  {msg.text}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ color: "#9ca3af", fontSize: "0.8rem" }}>Thinking...</div>
            )}
          </div>
          <div style={{ display: "flex", gap: "0.5rem" }}>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !chatLoading && sendChat()}
              disabled={!isRunning || chatLoading}
              placeholder={isRunning ? "Type a message..." : "Agent not running"}
              style={{
                flex: 1, padding: "0.5rem 0.75rem", borderRadius: "6px",
                border: "1px solid #d1d5db", fontSize: "0.875rem",
              }}
            />
            <button
              onClick={sendChat}
              disabled={!isRunning || chatLoading || !chatInput.trim()}
              style={{
                padding: "0.5rem 1rem", borderRadius: "6px", border: "none",
                background: "#2563eb", color: "white", cursor: "pointer",
                opacity: isRunning && !chatLoading ? 1 : 0.5,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
