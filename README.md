# Claw for Everyone

AI Worker Platform — Assign 24/7 AI agents, invite them to Slack/Telegram/Discord, teach them skills.

## Quick Start

```bash
# Install dependencies
pnpm install

# Initialize
pnpm affisto init

# Create an agent
pnpm affisto create my-agent --llm claude

# Start the admin console
pnpm affisto web
```

## Architecture

```
packages/
├── runtime/     # Agent container management (Docker)
├── skills/      # Skill system & registry
├── shared-db/   # SQLite DB + web renderer (Drizzle ORM)
├── channels/    # Slack, Telegram, Discord integrations
├── cli/         # CLI (affisto command)
└── web/         # Admin console (Next.js)
```

## Features

- Container-isolated AI agents (Docker)
- Multi-LLM support (Claude, OpenAI, Gemini, Ollama, LM Studio)
- Multi-channel messaging (Slack, Telegram, Discord)
- Skill system with registry
- Shared resource DB + web renderer
- Admin web UI

## License

MIT
