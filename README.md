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

## Quick Start

### Prerequisites

- Node.js (18+)
- Rust (latest stable)
- PostgreSQL
- Caddy web server
- sqlx-cli (`cargo install sqlx-cli`)

### Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd opencord
   ```

2. **Set up environment**
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Check requirements**
   ```bash
   make check-requirements
   ```

4. **Generate certificates**
   ```bash
   make generate-certs
   ```

5. **Build and run**
   ```bash
   make build
   make run
   ```

## Project Structure

```
opencord/
├── client/          # SolidJS frontend application
├── server/          # Rust backend server
├── prot/           # WebTransport protocol implementation
│   ├── client/     # Transport client library
│   └── server/     # Transport server library
├── utils/          # Shared utilities
└── Makefile        # Build automation
```

## Development

- **Frontend**: SolidJS with TypeScript, Vite, Tailwind CSS
- **Backend**: Rust with Axum, SQLx, PostgreSQL
- **Transport**: Custom WebTransport implementation
- **Build**: Make-based build system

## License

MIT License
