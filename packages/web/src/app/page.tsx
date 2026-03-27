export default function Home() {
  return (
    <main style={{ maxWidth: 800, margin: "0 auto", padding: "2rem" }}>
      <h1>Claw for Everyone</h1>
      <p>AI Worker Platform — Assign 24/7 AI agents to your channels</p>
      <hr />
      <section>
        <h2>Agents</h2>
        <p>No agents yet. Use the CLI to create one:</p>
        <pre>affisto create my-agent --llm claude</pre>
      </section>
    </main>
  );
}
