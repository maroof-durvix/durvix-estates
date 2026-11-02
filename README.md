# DURVIX Estates — Luxury Real Estate, Protected

A premium luxury real estate platform built on an **Anti-Commission Leakage Framework**. Browse and secure villas, penthouses, and mansions across Karachi, Lahore, and Islamabad — engineered so no deal can bypass the platform.

## The Three Defensive Layers

1. **Layer 1 — PII Masking**: Every phone number and email is masked (`+92-321-*******`, `h***@durvix.com`) until a deal is token-confirmed.
2. **Layer 2 — Token Amount System**: A PKR 5,000 commitment fee secures every viewing. No token, no lead to the agent.
3. **Layer 3 — Programmatic Agent Ban**: One admin toggle flips an agent to blocked — their listings vanish from the public feed instantly.

## Tech Stack

- **Framework**: Next.js 16 (App Router) + TypeScript 5
- **Styling**: Tailwind CSS 4 + shadcn/ui (New York)
- **Database**: Prisma ORM + SQLite
- **State**: Zustand (SPA navigation + auth) with localStorage persistence
- **Fonts**: Marcellus (display) + Inter (body)
- **Design**: Strict 90-degree corners (zero border-radius), Walnut Brown (#8B5A2B) accent, Pure White background

## Getting Started

```bash
# 1. Install dependencies
bun install

# 2. Set up the database (edit .env if needed — defaults to SQLite)
cp .env.example .env
bun run db:push     # creates tables from prisma/schema.prisma

# 3. Start the dev server
bun run dev         # http://localhost:3000
```

The database auto-seeds on first API request with:
- 1 admin, 3 agents (Karachi/Lahore/Islamabad), 1 demo buyer
- 8 luxury properties (villas, penthouses, mansions)

## Demo Accounts

| Role  | Email                | Password   |
|-------|----------------------|------------|
| Admin | admin@durvix.com    | admin123   |
| Buyer | user@durvix.com     | user123    |
| Agent | hassan@durvix.com   | agent123   |
| Agent | bilal@durvix.com    | agent123   |
| Agent | sana@durvix.com     | agent123   |

## Project Structure

```
src/
├── app/
│   ├── api/                  # Next.js route handlers (REST API)
│   │   ├── auth/             # register, login, me, logout
│   │   ├── properties/       # list, get, create
│   │   ├── bookings/         # list, create, pay-token (Layer 2)
│   │   ├── agents/           # list, ban, approve (Layer 3)
│   │   ├── admin/            # stats, agents list
│   │   └── contact/          # contact messages
│   ├── globals.css           # Design system: fonts, colors, zero-radius
│   ├── layout.tsx            # Marcellus + Inter fonts
│   └── page.tsx              # SPA root (view-switching via Zustand)
├── components/
│   ├── site/                 # Header, Footer, Logo, AuthDialog, PropertyCard
│   └── pages/                # Home, Properties, PropertyDetails, Agents,
│                              #   About, Contact, User/Agent/Admin dashboards,
│                              #   TokenPaymentSimulator
├── lib/
│   ├── auth.ts               # scrypt password hashing + HMAC token signing
│   ├── pii.ts                # Layer 1: phone/email masking
│   ├── mappers.ts            # Prisma entity → public shape (with masking)
│   ├── session.ts            # token verification helpers
│   ├── seed.ts               # auto-seed data
│   ├── api.ts                # typed client fetch helper
│   ├── constants.ts          # token amount, cities, coordinates
│   └── format.ts             # PKR / date formatting
├── store/
│   └── app.ts                # Zustand store (navigation + auth)
└── types/
    └── index.ts              # shared TypeScript interfaces

prisma/
└── schema.prisma             # User, Property, Booking, ContactMessage
```

## Key Features

- **Home page**: Luxury hero, Buy/Rent search tabs, city showcase cards, featured residences, anti-leakage framework section
- **Properties page (split screen)**: Custom SVG Pakistan map with price-callout pins (left) + filterable property grid (right)
- **Property details**: Photo gallery with index indicator ("1 of 12"), sticky Walnut Brown sidebar, Schedule Viewing flow
- **Agent directory**: Approved agents with masked contact details
- **User dashboard**: Bookings list + Token Payment Simulator (Validating → Securing → Confirming → Confirmed)
- **Agent dashboard**: Add-property form + token-paid buyers list (buyer contact revealed to agent)
- **Admin dashboard (Control Room)**: Revenue stats, pending approvals, One-Click Ban table

## Scripts

```bash
bun run dev        # start dev server (port 3000)
bun run lint       # ESLint
bun run db:push    # push schema to database
bun run db:generate # regenerate prisma client
```

## Notes

- This is a demo/sandbox project — the token payment is simulated (no real payment gateway).
- The `.env.example` file contains the default SQLite database URL. Copy it to `.env` before running.
- `node_modules` is not included — run `bun install` to restore dependencies.
