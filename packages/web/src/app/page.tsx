"use client";

import { useEffect, useState, useCallback } from "react";

interface Agent {
  id: string;
  name: string;
  llmProvider: string;
  llmModel: string | null;
  status: string;
  containerId: string | null;
  createdAt: number;
}

export default function Dashboard() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [newName, setNewName] = useState("");
  const [newLlm, setNewLlm] = useState("claude");
  const [loading, setLoading] = useState(false);

  const fetchAgents = useCallback(async () => {
    const res = await fetch("/api/agents");
    const data = await res.json();
    setAgents(data);
  }, []);

  useEffect(() => {
    fetchAgents();
    const interval = setInterval(fetchAgents, 5000);
    return () => clearInterval(interval);
  }, [fetchAgents]);

  const createAgent = async () => {
    if (!newName.trim()) return;
    setLoading(true);
    await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, llm: newLlm }),
    });
    setNewName("");
    await fetchAgents();
    setLoading(false);
  };

  const agentAction = async (id: string, action: "start" | "stop") => {
    await fetch(`/api/agents/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    await fetchAgents();
  };

  const removeAgent = async (id: string) => {
    if (!confirm("Remove this agent?")) return;
    await fetch(`/api/agents/${id}`, { method: "DELETE" });
    await fetchAgents();
  };

  const statusColor = (status: string) => {
    if (status === "running") return "#22c55e";
    if (status === "stopped" || status === "exited") return "#ef4444";
    if (status === "created") return "#f59e0b";
    return "#6b7280";
  };

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "2rem", fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "0.5rem" }}>
        Claw for Everyone
      </h1>
      <p style={{ color: "#6b7280", marginBottom: "2rem" }}>
        AI Worker Platform — Manage your agents
      </p>

      {/* Create Agent */}
      <div style={{
        display: "flex", gap: "0.5rem", marginBottom: "2rem",
        padding: "1rem", background: "#f9fafb", borderRadius: "8px", border: "1px solid #e5e7eb",
      }}>
        <input
          type="text"
          placeholder="Agent name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && createAgent()}
          style={{
            flex: 1, padding: "0.5rem 0.75rem", borderRadius: "6px",
            border: "1px solid #d1d5db", fontSize: "0.875rem",
          }}
        />
        <select
          value={newLlm}
          onChange={(e) => setNewLlm(e.target.value)}
          style={{
            padding: "0.5rem 0.75rem", borderRadius: "6px",
            border: "1px solid #d1d5db", fontSize: "0.875rem",
          }}
        >
          <option value="claude">Claude</option>
          <option value="openai">OpenAI</option>
          <option value="gemini">Gemini</option>
          <option value="ollama">Ollama</option>
        </select>
        <button
          onClick={createAgent}
          disabled={loading || !newName.trim()}
          style={{
            padding: "0.5rem 1rem", borderRadius: "6px", border: "none",
            background: "#2563eb", color: "white", cursor: "pointer",
            fontSize: "0.875rem", opacity: loading ? 0.5 : 1,
          }}
        >
          Create Agent
        </button>
      </div>

      {/* Agent List */}
      {agents.length === 0 ? (
        <p style={{ color: "#9ca3af", textAlign: "center", padding: "2rem" }}>
          No agents yet. Create one above.
        </p>
      ) : (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ borderBottom: "2px solid #e5e7eb", textAlign: "left" }}>
              <th style={{ padding: "0.75rem 0.5rem", fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase" }}>Name</th>
              <th style={{ padding: "0.75rem 0.5rem", fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase" }}>LLM</th>
              <th style={{ padding: "0.75rem 0.5rem", fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase" }}>Status</th>
              <th style={{ padding: "0.75rem 0.5rem", fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase" }}>Container</th>
              <th style={{ padding: "0.75rem 0.5rem", fontSize: "0.75rem", color: "#6b7280", textTransform: "uppercase" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} style={{ borderBottom: "1px solid #f3f4f6" }}>
                <td style={{ padding: "0.75rem 0.5rem", fontWeight: 500 }}>{a.name}</td>
                <td style={{ padding: "0.75rem 0.5rem", color: "#6b7280" }}>{a.llmProvider}</td>
                <td style={{ padding: "0.75rem 0.5rem" }}>
                  <span style={{
                    display: "inline-flex", alignItems: "center", gap: "0.375rem",
                    padding: "0.125rem 0.5rem", borderRadius: "9999px",
                    fontSize: "0.75rem", fontWeight: 500,
                    background: statusColor(a.status) + "20", color: statusColor(a.status),
                  }}>
                    <span style={{
                      width: 6, height: 6, borderRadius: "50%",
                      background: statusColor(a.status),
                    }} />
                    {a.status}
                  </span>
                </td>
                <td style={{ padding: "0.75rem 0.5rem", fontFamily: "monospace", fontSize: "0.75rem", color: "#9ca3af" }}>
                  {a.containerId?.slice(0, 12) || "—"}
                </td>
                <td style={{ padding: "0.75rem 0.5rem", display: "flex", gap: "0.375rem" }}>
                  {a.status !== "running" && (
                    <button
                      onClick={() => agentAction(a.id, "start")}
                      style={{
                        padding: "0.25rem 0.625rem", borderRadius: "4px", border: "1px solid #d1d5db",
                        background: "white", cursor: "pointer", fontSize: "0.75rem",
                      }}
                    >
                      Start
                    </button>
                  )}
                  {a.status === "running" && (
                    <button
                      onClick={() => agentAction(a.id, "stop")}
                      style={{
                        padding: "0.25rem 0.625rem", borderRadius: "4px", border: "1px solid #d1d5db",
                        background: "white", cursor: "pointer", fontSize: "0.75rem",
                      }}
                    >
                      Stop
                    </button>
                  )}
                  <button
                    onClick={() => removeAgent(a.id)}
                    style={{
                      padding: "0.25rem 0.625rem", borderRadius: "4px", border: "1px solid #fecaca",
                      background: "white", color: "#ef4444", cursor: "pointer", fontSize: "0.75rem",
                    }}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
