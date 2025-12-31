# Opencord

<div align="center">
  <img src="client/src/assets/opencord.webp" alt="Opencord Logo" width="200" height="200">
</div>

A modern real-time communication platform built with Rust and SolidJS.

> **Disclaimer:** This is a hobby project made for fun to use with friends. It does not compete with Discord in any way — Discord is vastly superior in quality, features, and reliability. Opencord is in a very early alpha state with numerous bugs and likely security issues. Use at your own risk.

## Features

- Real-time messaging with WebTransport
- Voice and video communication
- Channel-based organization
- Role-based permissions
- File sharing
- Modern web interface

## Compatibility

| Platform | Support |
|----------|---------|
| Electron | Full support |
| Chrome/Chromium | Full support |
| Edge | Full support |
| Firefox | No screen share or camera support, also bugs |
| Safari | Not supported |

## Prerequisites

- Node.js 20.19+
- pnpm (`npm install -g pnpm`)
- Rust 1.85+
- PostgreSQL
- OpenSSL
- xxd
- sqlx-cli (`cargo install sqlx-cli`)
- certbot (production only)

## Development

### Setup

```bash
git clone <repository-url>
cd opencord
cp .env.example .env
# Edit .env with your DATABASE_URL
./generate-dev-certs  # Add the output to .env
```

### Running

Run client and server in separate terminals:

```bash
# Terminal 1 - Client (hot reload)
make install
make dev-client

# Terminal 2 - Server (debug mode)
make dev-server
make dev-run
```

Client runs at `https://localhost:5173`, server at `https://localhost:3000`

## Production

### Setup

```bash
git clone <repository-url>
cd opencord
cp .env.example .env
# Edit .env with your DATABASE_URL
# Set SERVE_CLIENT=true to serve frontend from server
./generate-prod-certs yourdomain.com  # Add the output to .env
```

### Running

```bash
make install       # Install dependencies
make prod-client   # Build client (if SERVE_CLIENT=true)
make prod-server   # Build server
make prod-run      # Run server
```

Access at `https://yourdomain.com:3000`

The first user should register using the invite code `OWNER_INVITE_2024` to become the server owner.

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `CERT_PATH` | Path to TLS certificate | required |
| `KEY_PATH` | Path to TLS private key | required |
| `SERVE_CLIENT` | Serve frontend from server | false |

## Make Commands

| Command | Description |
|---------|-------------|
| `make install` | Install npm dependencies |
| `make clean` | Remove build artifacts |
| `make dev-client` | Run web client dev server with hot reload |
| `make dev-electron` | Run Electron client in dev mode |
| `make dev-server` | Build server in debug mode |
| `make dev-run` | Run server in debug mode |
| `make prod-client` | Build web client for server |
| `make prod-electron` | Build Electron desktop app |
| `make prod-server` | Build server (with database setup) |
| `make prod-run` | Run server (release mode) |
| `make prod-stop` | Stop server |
| `make db-create` | Create database |
| `make db-migrate` | Run database migrations |
| `make db-reset` | Drop and recreate database |

## Project Structure

```
opencord/
├── client/          # SolidJS frontend
├── server/          # Rust backend
├── transport/       # WebTransport implementation
├── utils/           # Shared utilities
├── certs/           # TLS certificates
└── Makefile         # Build automation
```

## Permissions System

Opencord uses a role-based permission system where users belong to roles, and roles have specific rights for each group/channel.

### Rights Levels

| Level | Name | Description |
|-------|------|-------------|
| 0 | Hidden | No access - group/channel is invisible |
| 1 | Ack | Can see the group/channel exists |
| 2 | Read | Can read messages and listen to voice |
| 4 | Write | Can send messages and speak in voice |
| 8 | ACL | Full control - manage permissions, kick users, delete messages |

### Special Roles

| Role ID | Name | Description |
|---------|------|-------------|
| 1 | Owner | Absolute authority over the server |
| 2 | Admin | Maximum rights everywhere, can do everything except modify Owner |
| 3 | Default | The role new users are assigned when they register |

### Who Can Do What

| Action | Required Right | Notes |
|--------|---------------|-------|
| See a group/channel | Ack (1) | |
| Read messages | Read (2) | |
| Listen to voice | Read (2) | |
| Send messages | Write (4) | |
| Speak in voice | Write (4) | |
| Join voice channel | Read (2) | |
| Share screen/camera | Write (4) | Chromium browsers only |
| Delete any message | ACL (8) | |
| Kick users from voice | ACL (8) | Cannot kick Owner/Admin unless you are Owner |
| Modify permissions | ACL (8) | Only Owner/Admin can grant/remove ACL rights |
| Create groups/channels/roles | Owner/Admin | |
| Delete normal users | Owner/Admin | |
| Delete Admin users | Owner only | |
| Assign role to normal user | Owner/Admin | Change which role a user belongs to |
| Assign role to Admin user | Owner only | Change which role an Admin belongs to |

### Permission Hierarchy

- Channels inherit permissions from their parent group
- Owner can moderate anyone
- Admin can moderate anyone except Owner
- Users with ACL can only moderate non-Owner, non-Admin users
- **ACL rights for non-Owner/Admin users are local to each group** - a user may have ACL in one group but not others

### User Management Rules

- Only Owner or Admin can create groups, channels, and roles
- Owner or Admin can delete any normal user (role 3+)
- Only Owner can delete Admin users
- Owner or Admin can assign any role to normal users
- Only Owner can assign a different role to Admin users
- Owner's role cannot be changed

## License

AGPL-3.0
