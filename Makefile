check-requirements:
	@echo "Checking system requirements..."
	@command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Please install Node.js"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "npm is not installed. Please install npm"; exit 1; }
	@command -v cargo >/dev/null 2>&1 || { echo "Rust/Cargo is not installed. Please install Rust"; exit 1; }
	@command -v sqlx >/dev/null 2>&1 || { echo "sqlx-cli is not installed. Please install with: cargo install sqlx-cli"; exit 1; }
	@command -v caddy >/dev/null 2>&1 || { echo "Caddy is not installed. Please install Caddy"; exit 1; }
	@test -f .env || { echo ".env file not found. Please copy .env.example to .env"; exit 1; }
	@echo "All requirements satisfied!"

build: check-requirements
	sqlx database create
	cd server && sqlx migrate run
	cd client && npm run build
	cd server && cargo build --release

run:
	cd server && ./target/release/server &
	caddy run --config Caddyfile.prod --adapter caddyfile

stop:
	pkill -f "target/release/server" || true
	pkill -f "caddy" || true

generate-certs:
	cd server/certs && ./generate
	@NEW_HASH=$$(cat server/certs/localhost.hex); \
	sed -i.bak 's|VITE_CERT_HASH=.*|VITE_CERT_HASH='$$NEW_HASH'|' .env && rm -f .env.bak; \
	sed -i.bak 's|VITE_CERT_HASH=.*|VITE_CERT_HASH='$$NEW_HASH'|' .env.example && rm -f .env.example.bak

clean:
	cd client && rm -rf dist
	cd server && cargo clean
