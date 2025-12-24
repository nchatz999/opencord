.PHONY: check-node check-rust install build build-client build-electron server run stop clean

check-node:
	@command -v node >/dev/null 2>&1 || { echo "Node.js is not installed"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "npm is not installed"; exit 1; }

check-rust:
	@command -v cargo >/dev/null 2>&1 || { echo "Rust/Cargo is not installed"; exit 1; }
	@command -v sqlx >/dev/null 2>&1 || { echo "sqlx-cli is not installed. Run: cargo install sqlx-cli"; exit 1; }

install: check-node
	npm install

build-client: check-node
	cd client && npm run build

build-electron: check-node
	cd client && npm run build:electron

build: check-node check-rust install
	sqlx database create
	cd server && sqlx migrate run
	$(MAKE) build-client
	cd server && cargo build --release

server: check-rust
	cd server && cargo build --release

run:
	cd server && cargo run --release

stop:
	pkill -x server || true

clean:
	rm -rf client/dist client/dist-electron
	cd server && cargo clean
