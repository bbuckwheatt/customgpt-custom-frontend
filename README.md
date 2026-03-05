# CustomGPT Chat Frontend

A production-ready chat frontend for deploying your [CustomGPT](https://customgpt.ai) agent as a standalone web application. Built on the Vercel AI Chatbot template, it replaces the generic LLM backend with CustomGPT's OpenAI-compatible streaming API while adding conversation persistence, credential-based authentication, and tiered per-user rate limiting.

---

## What It Does

- **CustomGPT-powered responses** — streams directly from your agent via CustomGPT's SSE endpoint, preserving your agent's configured persona, knowledge base, and instructions
- **Persistent conversation history** — every chat is stored per-user in Postgres and surfaced in a sidebar; users can resume past conversations at any time
- **Auth-gated access** — users register with email + password or continue as a guest; all routes are protected via Next.js middleware
- **Tiered rate limiting** — message quotas enforced server-side per user type:
  | User type | Messages per hour |
  |-----------|-------------------|
  | Guest     | 5                 |
  | Registered | 10               |
  | Admin     | Unlimited         |
- **Artifact panel** — the model can emit structured `<artifact>` blocks that render in a side panel as a rich text editor (ProseMirror), syntax-highlighted code editor, or spreadsheet view, with version history and copy-to-clipboard
- **Real-time streaming** — text deltas are forwarded to the browser incrementally as they arrive from CustomGPT, with artifact content delivered after the stream closes

---

## Architecture

```
Browser
  └── Next.js App Router (React 19)
        ├── app/(auth)/          Auth pages + NextAuth credentials provider
        ├── app/(chat)/          Chat UI routes + API handlers
        └── components/          Client-side chat shell, artifact panel, streaming

Server (API routes — Node.js runtime)
  ├── POST /api/chat             Core handler: auth → rate limit → CustomGPT stream
  ├── GET  /api/history          Paginated conversation list (SWR infinite)
  ├── GET  /api/document         Artifact document fetch (SWR)
  └── POST /api/files/upload     Blob upload

Data layer
  ├── Neon Postgres (Drizzle ORM)  Users, chats, messages, documents, votes
  ├── Vercel Blob                  File attachments
  └── Redis                        IP-based rate limit counters (production only)

External
  └── CustomGPT API               SSE streaming, agent persona + knowledge base
```

### Key design decisions

**Next.js App Router + React Server Components**
Pages that need data (chat history, document versions) are server-rendered — no waterfall client fetches, no loading spinners for initial content. Client components are used only where interactivity is required.

**Vercel AI SDK (`useChat` / `UIMessageStreamWriter`)**
The SDK handles the browser-side streaming protocol (chunked fetch, message part assembly, optimistic UI updates) without custom WebSocket infrastructure. The server-side `createUIMessageStream` writer lets us inject custom `data-*` events (artifact deltas, rate limit signals) alongside text without breaking the standard message format.

**CustomGPT via its OpenAI-compatible SSE endpoint**
No SDK wrapper needed — a standard `fetch` with `Accept: text/event-stream` is sufficient. The server buffers artifact XML blocks while forwarding plain text deltas in real time, then emits structured artifact events after the stream closes. This keeps latency low for conversational responses while still supporting rich artifact output.

**Auth.js (credentials + guest)**
JWT-based sessions with no external OAuth dependency. The guest provider auto-creates an anonymous account in the database, giving unauthenticated users access to conversation history within a session while still being subject to rate limits. Admin status is determined by a hardcoded email allowlist at sign-in time and stored in the JWT.

**Drizzle ORM + Neon Postgres**
Type-safe schema with auto-generated migrations. Messages are stored as structured JSON `parts` arrays (Vercel AI SDK v6 format), making it straightforward to replay full conversations back to CustomGPT.

**Redis for rate limiting**
A single `INCR` + `EXPIRE NX` pipeline per request provides atomic, TTL-rolling counters with no race conditions. Redis is only consulted in production; local development skips it entirely.

**SWR for artifact state**
Artifact content, kind, and status live in SWR's cache rather than component state. This means any component in the tree can read or update artifact state without prop drilling, and optimistic mutations during streaming are automatically reconciled with server-fetched versions once streaming ends.

---

## Project Map

```
├── app/
│   ├── (auth)/
│   │   ├── auth.ts                  NextAuth config, user type resolution, admin list
│   │   ├── auth.config.ts           Auth callbacks and route config
│   │   ├── actions.ts               Server actions: login, register, guest sign-in
│   │   ├── login/page.tsx           Login page
│   │   ├── register/page.tsx        Register page
│   │   └── api/auth/
│   │       ├── [...nextauth]/       NextAuth API handler
│   │       └── guest/               Guest session creation endpoint
│   ├── (chat)/
│   │   ├── page.tsx                 Home — redirects to new chat
│   │   ├── layout.tsx               Chat shell layout (sidebar + main)
│   │   ├── actions.ts               Server actions: save chat, delete chat, save document
│   │   ├── chat/[id]/page.tsx       Individual chat page (server-rendered)
│   │   └── api/
│   │       ├── chat/route.ts        ★ Core: auth → rate limit → CustomGPT stream
│   │       ├── chat/schema.ts       Zod request schema
│   │       ├── chat/[id]/stream/    Stream resumption endpoint
│   │       ├── history/route.ts     Paginated chat history
│   │       ├── document/route.ts    Document CRUD
│   │       ├── suggestions/         Inline suggestion API
│   │       ├── vote/                Message vote API
│   │       └── files/upload/        Blob file upload
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
│   │   ├── customgpt.ts             ★ CustomGPT SSE streaming, artifact XML parsing
│   │   ├── entitlements.ts          ★ Per-user-type message quotas
│   │   ├── prompts.ts               System prompt construction
│   │   ├── models.ts                Model registry (single CustomGPT entry)
│   │   └── tools/                   AI SDK tool definitions (create/update document)
│   ├── db/
│   │   ├── schema.ts                Drizzle schema: User, Chat, Message_v2, Document
│   │   ├── queries.ts               All database queries
│   │   ├── migrate.ts               Migration runner
│   │   └── migrations/              SQL migration files
│   ├── editor/
│   │   ├── config.ts                ProseMirror schema definition
│   │   ├── functions.tsx            ★ buildDocumentFromContent (markdown → ProseMirror)
│   │   └── suggestions.tsx          Inline suggestion decorations
│   ├── ratelimit.ts                 ★ Redis IP-based rate limiting
│   ├── errors.ts                    Typed ChatbotError with error codes
│   └── types.ts                     ChatMessage, CustomUIDataTypes, tool types
│
├── hooks/
│   ├── use-artifact.ts              SWR-backed artifact state
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

# CustomGPT
CUSTOMGPT_API_KEY=    # API key from app.customgpt.ai → Profile → API
CUSTOMGPT_PROJECT_ID= # Agent/project ID from the URL when viewing your agent

# Database
POSTGRES_URL=         # Neon (or any Postgres) connection string

# File storage
BLOB_READ_WRITE_TOKEN= # Vercel Blob token

# Rate limiting (production only — omit to disable)
REDIS_URL=            # Redis connection string
```

---

## Running Locally

```bash
pnpm install
pnpm db:migrate   # Create tables
pnpm dev          # Starts on http://localhost:3000
```

> Redis rate limiting is automatically disabled when `NODE_ENV !== "production"` or when `REDIS_URL` is not set.

## Deploying

The project is configured for Vercel. Set all environment variables in the Vercel dashboard and deploy — Neon Postgres, Vercel Blob, and Upstash Redis all have first-party Vercel integrations.

```bash
vercel deploy
```
