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

## Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome/Chromium | Full support |
| Edge | Full support |
| Firefox | No screen share or camera support |
| Safari | Not supported |

## Local Development

### Prerequisites

- Node.js 20.19+
- Rust 1.85+
- PostgreSQL
- OpenSSL
- xxd
- sqlx-cli (`cargo install sqlx-cli`)

### Setup

```bash
# Clone and setup
git clone <repository-url>
cd opencord
cp .env.example .env
# Edit .env with your DATABASE_URL

# Generate dev certificates 
./generate-dev-certs

# Build and run
make build
make run
```

Access at `https://localhost:3000`

## Production Deployment

### Prerequisites

- Node.js 20.19+
- Rust 1.85+
- PostgreSQL
- sqlx-cli (`cargo install sqlx-cli`)
- certbot

### Setup

```bash
# Clone and setup
git clone <repository-url>
cd opencord
cp .env.example .env
# Edit .env with your DATABASE_URL and set SERVE_CLIENT=true

# Generate certificates
./generate-prod-certs yourdomain.com

# Build and run
make build
make run
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | required |
| `CERT_PATH` | Path to TLS certificate | required |
| `KEY_PATH` | Path to TLS private key | required |
| `SERVE_CLIENT` | Serve frontend from server | false |

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

## License

AGPL-3.0
