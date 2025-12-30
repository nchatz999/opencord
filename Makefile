.PHONY: check-node check-rust install build build-client build-electron server run stop clean

check-node:
	@command -v node >/dev/null 2>&1 || { echo "Node.js is not installed"; exit 1; }
	@command -v pnpm >/dev/null 2>&1 || { echo "pnpm is not installed. Run: npm install -g pnpm"; exit 1; }

check-rust:
	@command -v cargo >/dev/null 2>&1 || { echo "Rust/Cargo is not installed"; exit 1; }
	@command -v sqlx >/dev/null 2>&1 || { echo "sqlx-cli is not installed. Run: cargo install sqlx-cli"; exit 1; }

install: check-node
	pnpm install

build-client: check-node
	pnpm --filter opencord-client run build:web

build-electron: check-node
	cd client && pnpm run build && pnpm exec electron-builder

server: check-rust
	cd server && sqlx database create && sqlx migrate run && cargo build --release

run:
	cargo run --release -p opencord-server &

stop:
	pkill -x server || true

clean:
	rm -rf client/dist client/dist-electron
	cd server && cargo clean
