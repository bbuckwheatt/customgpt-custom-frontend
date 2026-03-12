# CustomGPT Chat Frontend

A production-ready chat frontend for deploying your [CustomGPT](https://customgpt.ai) agent as a standalone web application. Built on the Vercel AI Chatbot template, it replaces the generic LLM backend with CustomGPT's native conversation API while adding conversation persistence, credential-based authentication, and tiered per-user rate limiting.

---

## What It Does

- **CustomGPT-powered responses** — streams directly from your agent via CustomGPT's native conversation API, preserving your agent's configured persona, knowledge base, and instructions. Each chat maps to a CustomGPT conversation session, so the agent retains full context across messages without replaying history.
- **Persistent conversation history** — every chat is stored per-user in Postgres and surfaced in a sidebar; users can resume past conversations at any time
- **Auth-gated access** — users register with email + password or continue as a guest; all routes are protected via Next.js middleware
- **Tiered rate limiting** — message quotas enforced server-side per user type:
  | User type | Messages per hour |
  |-----------|-------------------|
  | Guest     | 5                 |
  | Registered | 10               |
  | Admin     | Unlimited         |
- **Artifact panel** — the model can emit structured `<artifact>` blocks that render in a side panel as a rich text editor (ProseMirror), syntax-highlighted code editor, or spreadsheet view, with version history and copy-to-clipboard. Artifact instructions are injected per-message via CustomGPT's `custom_context` parameter.
- **Real-time streaming** — text deltas are forwarded to the browser word-by-word as they arrive from CustomGPT, with a drip delay to smooth out bursty SSE chunks. A thinking indicator stays visible until the first token arrives.
- **Voice input** — microphone button in the chat toolbar uses the Web Speech API for voice-to-text transcription, appending to any existing input
- **Text-to-speech** — speaker icon on assistant messages reads responses aloud via the SpeechSynthesis API, with a stop button to cancel

---

## Why This Stack

CustomGPT turns any document collection, website, or knowledge base into a production-ready AI agent — complete with a configured persona, source citations, and guardrails — without ML engineering. Vercel provides the deployment and runtime layer that makes that agent customer-facing: globally distributed serverless compute, a managed storage ecosystem, and built-in observability. The combination means a business can go from a curated knowledge base to a fully branded, auth-gated chat product — with conversation history, tiered access, and real-time streaming responses — without owning infrastructure or training a model. Time-to-launch is measured in days rather than quarters, and operating costs track usage rather than reserved capacity.

The architecture draws a deliberate line between what is resolved on the server and what runs in the browser. Pages that depend on persisted data are assembled before the first byte reaches the client, eliminating the round-trip waterfall that client-fetching would require; only the parts of the UI that genuinely need interactivity — the message input, voice transcription, live token delivery, artifact editing — run in the browser. Incoming response tokens are forwarded incrementally as they arrive from CustomGPT, and a loading indicator bridges the submission-to-first-token gap so users never face a blank response area; authentication resolution is isolated in a narrow deferred boundary so the sidebar is sized correctly from the first painted frame, removing layout shift. Shared mutable state — artifact content and status — lives in a per-conversation client cache so any component can read or update it without prop drilling, and optimistic mutations are reconciled against server-confirmed versions once the stream closes. Each dependency was chosen to pay for its own complexity: the AI SDK abstracts the streaming wire protocol, a typed ORM makes schema changes auditable, and JWT-based sessions avoid an external identity provider. Vercel's platform handles distribution, compression, and TLS automatically; native integrations with Neon Postgres, Blob storage, and Upstash Redis provision and scale without configuration; and real-user performance telemetry gives visibility into load and layout regressions before they affect end users.

---

## Architecture

```
Browser
  └── Next.js App Router (React 19)
        ├── app/(auth)/          Auth pages + NextAuth credentials provider
        ├── app/(chat)/          Chat UI routes + API handlers
        └── components/          Client-side chat shell, artifact panel, streaming

Server (API routes — Node.js runtime)
  ├── POST /api/chat             Core handler: auth → rate limit → session create → CustomGPT stream
  ├── GET  /api/history          Paginated conversation list (SWR infinite)
  ├── GET  /api/document         Artifact document fetch (SWR)
  └── POST /api/files/upload     Blob upload (API only; upload UI is disabled by default)

Data layer
  ├── Neon Postgres (Drizzle ORM)  Users, chats (with sessionId), messages, documents, votes
  ├── Vercel Blob                  File attachments
  └── Redis                        Resumable stream state (production only)

External
  └── CustomGPT API               Native conversation API (session-based), SSE streaming
```

### Key design decisions

**Next.js App Router + React Server Components**
Pages that need data (chat history, document versions) are server-rendered — no waterfall client fetches, no loading spinners for initial content. Client components are used only where interactivity is required.

**Vercel AI SDK (`useChat` / `UIMessageStreamWriter`)**
The SDK handles the browser-side streaming protocol (chunked fetch, message part assembly, optimistic UI updates) without custom WebSocket infrastructure. The server-side `createUIMessageStream` writer lets us inject custom `data-*` events (artifact deltas, rate limit signals) alongside text without breaking the standard message format.

**CustomGPT via its native conversation API**
Each chat creates a conversation session via `POST /projects/{id}/conversations`, and messages are sent to `POST /projects/{id}/conversations/{sessionId}/messages?stream=true`. CustomGPT manages conversation history server-side, so only the latest user message is sent per request. Artifact instructions are injected per-message via the `custom_context` parameter (≤500 chars). The server parses the native SSE format (`event: progress` → text deltas) and drips words to the browser with small delays for smooth rendering.

**Auth.js (credentials + guest)**
JWT-based sessions with no external OAuth dependency. The guest provider auto-creates an anonymous account in the database, giving unauthenticated users access to conversation history within a session while still being subject to rate limits. Admin status is determined by the `ADMIN_EMAILS` environment variable (comma-separated email addresses) at sign-in time and stored in the JWT.

**Drizzle ORM + Neon Postgres**
Type-safe schema with auto-generated migrations. Messages are stored as structured JSON `parts` arrays (Vercel AI SDK v6 format). Each chat record stores a `sessionId` linking it to a CustomGPT conversation, so the agent retains context without message replay.

**Redis for stream resumption**
When `REDIS_URL` is set, each streaming response is registered as a resumable stream. If a client disconnects mid-stream it can reconnect and pick up where it left off. Redis is only consulted in production; local development skips it entirely.

**SWR for artifact state**
Artifact content, kind, and status live in SWR's cache keyed per chat (e.g. `artifact-{chatId}`) rather than component state. This means any component in the tree can read or update artifact state without prop drilling, isolates artifact state across conversations, and ensures optimistic mutations during streaming are automatically reconciled with server-fetched versions once streaming ends.

---

## Project Map

```
├── app/
│   ├── (auth)/
│   │   ├── auth.ts                  NextAuth config, user type resolution, ADMIN_EMAILS env var
│   │   ├── auth.config.ts           Auth callbacks and route config
│   │   ├── actions.ts               Server actions: login, register, guest sign-in
│   │   ├── login/page.tsx           Login page
│   │   ├── register/page.tsx        Register page
│   │   └── api/auth/
│   │       ├── [...nextauth]/       NextAuth API handler
│   │       └── guest/               Guest session creation endpoint
│   ├── (chat)/
│   │   ├── page.tsx                 Home — renders new chat UI directly
│   │   ├── layout.tsx               Chat shell layout (sidebar + main)
│   │   ├── actions.ts               Server actions: title generation, delete trailing messages
│   │   ├── chat/[id]/page.tsx       Individual chat page (server-rendered)
│   │   └── api/
│   │       ├── chat/route.ts        ★ Core: auth → rate limit → session → CustomGPT stream
│   │       ├── chat/schema.ts       Zod request schema
│   │       ├── chat/[id]/stream/    Stream resumption endpoint
│   │       ├── history/route.ts     Paginated chat history
│   │       ├── document/route.ts    Document CRUD
│   │       ├── suggestions/         Inline suggestion API
│   │       ├── vote/                Message vote API
│   │       └── files/upload/        Blob file upload (API; UI button disabled by default)
│   ├── globals.css
│   └── layout.tsx                   Root layout (fonts, theme provider)
│
├── artifacts/
│   ├── text/
│   │   ├── client.tsx               Text artifact: onStreamPart, ProseMirror editor
│   │   └── server.ts                Server-side text artifact tools (AI SDK tools)
│   ├── code/
│   │   ├── client.tsx               Code artifact: syntax-highlighted editor
│   │   └── server.ts
│   ├── sheet/
│   │   ├── client.tsx               Spreadsheet artifact
│   │   └── server.ts
│   └── image/
│       └── client.tsx               Image artifact
│
├── components/
│   ├── chat.tsx                     ★ Main chat component: useChat, rate limit state
│   ├── messages.tsx                 Message list with thinking indicator logic
│   ├── multimodal-input.tsx         Chat input toolbar (text, voice, model selector)
│   ├── voice-button.tsx             Voice-to-text via Web Speech API (lazy loaded)
│   ├── speak-button.tsx             Text-to-speech via SpeechSynthesis API (lazy loaded)
│   ├── artifact.tsx                 Artifact side panel
│   ├── data-stream-handler.tsx      ★ Processes data-* stream events into artifact state
│   ├── data-stream-provider.tsx     Context for buffering incoming stream deltas
│   ├── create-artifact.tsx          Artifact registry and kind dispatcher
│   ├── text-editor.tsx              ProseMirror wrapper for text artifacts
│   ├── code-editor.tsx              CodeMirror wrapper for code artifacts
│   ├── app-sidebar.tsx              Conversation history sidebar
│   ├── chat-header.tsx              Chat header with model selector
│   ├── auth-form.tsx                Shared login/register form
│   └── ui/                          shadcn/ui primitives
│
├── lib/
│   ├── ai/
│   │   ├── customgpt.ts             ★ CustomGPT conversation API, SSE streaming, artifact parsing
│   │   ├── entitlements.ts          ★ Per-user-type message quotas
│   │   ├── prompts.ts               System prompt construction
│   │   ├── models.ts                Model registry (single CustomGPT entry)
│   │   └── tools/                   AI SDK tool definitions (create/update document)
│   ├── db/
│   │   ├── schema.ts                Drizzle schema: User, Chat (with sessionId), Message_v2, Document
│   │   ├── queries.ts               All database queries
│   │   ├── migrate.ts               Migration runner
│   │   └── migrations/              SQL migration files
│   ├── editor/
│   │   ├── config.ts                ProseMirror schema definition
│   │   ├── functions.tsx            ★ buildDocumentFromContent (markdown → ProseMirror)
│   │   └── suggestions.tsx          Inline suggestion decorations
│   ├── ratelimit.ts                 Redis IP-based rate limit helper (unused — IP limiting removed)
│   ├── errors.ts                    Typed ChatbotError with error codes
│   └── types.ts                     ChatMessage, CustomUIDataTypes, tool types
│
├── hooks/
│   ├── use-artifact.ts              SWR-backed artifact state, scoped per chat ID
│   ├── use-auto-resume.ts           Stream resumption on reconnect
│   ├── use-chat-visibility.ts       Public/private chat toggle
│   └── use-messages.tsx             Message list with vote state
│
├── .env.example                     Required environment variables
├── drizzle.config.ts                Drizzle Kit config
├── next.config.ts                   Next.js config
└── biome.jsonc                      Linter/formatter config
```

---

## Environment Variables

```bash
# Authentication
AUTH_SECRET=          # Random secret — generate with: openssl rand -base64 32

# Admin access
ADMIN_EMAILS=         # Comma-separated admin email addresses (e.g. you@example.com)

# CustomGPT
CUSTOMGPT_API_KEY=    # API key from app.customgpt.ai → Profile → API
CUSTOMGPT_PROJECT_ID= # Agent/project ID from the URL when viewing your agent

# Database
POSTGRES_URL=         # Neon (or any Postgres) connection string

# File storage
BLOB_READ_WRITE_TOKEN= # Vercel Blob token

# Stream resumption (production only — omit to disable)
REDIS_URL=            # Redis connection string
```

---

## Running Locally

```bash
pnpm install
pnpm db:migrate   # Create tables
pnpm dev          # Starts on http://localhost:3000
```

> Redis stream resumption is automatically disabled when `NODE_ENV !== "production"` or when `REDIS_URL` is not set.

## Deploying

The project is configured for Vercel. Set all environment variables in the Vercel dashboard and deploy — Neon Postgres, Vercel Blob, and Upstash Redis all have first-party Vercel integrations.

```bash
vercel deploy
```
