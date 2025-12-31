.PHONY: check-node check-rust install clean \
        dev-client dev-electron dev-server dev-run \
        prod-client prod-electron prod-server prod-run prod-stop \
        db-create db-migrate db-reset

# ═══════════════════════════════════════════════════════════════════════════════
# DEPENDENCY CHECKS
# ═══════════════════════════════════════════════════════════════════════════════
check-node:
	@command -v node >/dev/null 2>&1 || { echo "Node.js is not installed"; exit 1; }
	@command -v pnpm >/dev/null 2>&1 || { echo "pnpm is not installed. Run: npm install -g pnpm"; exit 1; }

check-rust:
	@command -v cargo >/dev/null 2>&1 || { echo "Rust/Cargo is not installed"; exit 1; }
	@command -v sqlx >/dev/null 2>&1 || { echo "sqlx-cli is not installed. Run: cargo install sqlx-cli"; exit 1; }

# ═══════════════════════════════════════════════════════════════════════════════
# INSTALL DEPENDENCIES
# ═══════════════════════════════════════════════════════════════════════════════
install: check-node
	pnpm install

clean:
	rm -rf client/dist client/dist-electron
	cd server && cargo clean

# ═══════════════════════════════════════════════════════════════════════════════
# DEVELOPMENT
# ═══════════════════════════════════════════════════════════════════════════════
dev-client: check-node
	pnpm --filter opencord-client run dev

dev-electron: check-node
	pnpm --filter opencord-client run dev:electron

dev-server: check-rust
	sqlx database create && sqlx migrate run --source server/migrations && cargo build -p opencord-server

dev-run:
	cargo run -p opencord-server

# ═══════════════════════════════════════════════════════════════════════════════
# PRODUCTION
# ═══════════════════════════════════════════════════════════════════════════════
prod-client: check-node
	pnpm --filter opencord-client run build:web

prod-electron: check-node
	pnpm --filter opencord-client run build && pnpm --filter opencord-client exec electron-builder

prod-server: check-rust
	sqlx database create && sqlx migrate run --source server/migrations && cargo build --release -p opencord-server

prod-run:
	cargo run --release -p opencord-server &

prod-stop:
	pkill -x server || true

# ═══════════════════════════════════════════════════════════════════════════════
# DATABASE
# ═══════════════════════════════════════════════════════════════════════════════
db-create: check-rust
	sqlx database create

db-migrate: check-rust
	sqlx migrate run --source server/migrations

db-reset: check-rust
	sqlx database drop -y && sqlx database create && sqlx migrate run --source server/migrations
