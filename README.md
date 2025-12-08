# Opencord

<div align="center">
  <img src="client/src/assets/opencord.webp" alt="OpenCord Logo" width="200" height="200">
</div>

A modern real-time communication platform built with Rust and SolidJS.

## Features

- Real-time messaging with WebTransport
- Voice and video communication
- Channel-based organization
- Role-based permissions
- File sharing
- Modern web interface

## Local Development

### Prerequisites

- Node.js (18+)
- Rust (latest stable)
- PostgreSQL
- sqlx-cli (`cargo install sqlx-cli`)

### Setup

```bash
# Clone and setup
git clone <repository-url>
cd opencord
cp .env.example .env

# Generate dev certificates
./generate-dev-certs

# Build and run
make build
make run
```

Access at `https://localhost:3000`

## Production Deployment

### Without Docker

1. **Install prerequisites**
   - Node.js 18+
   - Rust (latest stable)
   - PostgreSQL
   - sqlx-cli (`cargo install sqlx-cli`)

2. **Setup**
   ```bash
   cp .env.example .env
   # Edit .env with production DATABASE_URL and cert paths
   ```

3. **Generate certificates**
   ```bash
   ./generate-prod-certs yourdomain.com
   ```

4. **Update .env**
   ```
   CERT_PATH=certs/yourdomain.com.crt
   KEY_PATH=certs/yourdomain.com.key
   SERVE_CLIENT=true
   ```

5. **Build and run**
   ```bash
   make build
   make run
   ```

### With Docker

1. **Generate certificates**
   ```bash
   ./generate-prod-certs yourdomain.com
   ```

2. **Deploy**
   ```bash
   DOMAIN=yourdomain.com docker-compose up -d
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

MIT License
