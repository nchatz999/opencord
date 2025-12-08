check-requirements:
	@echo "Checking system requirements..."
	@command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Please install Node.js"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "npm is not installed. Please install npm"; exit 1; }
	@command -v cargo >/dev/null 2>&1 || { echo "Rust/Cargo is not installed. Please install Rust"; exit 1; }
	@command -v sqlx >/dev/null 2>&1 || { echo "sqlx-cli is not installed. Please install with: cargo install sqlx-cli"; exit 1; }
	@test -f .env || { echo ".env file not found. Please copy .env.example to .env"; exit 1; }
	@echo "All requirements satisfied!"

build: check-requirements
	sqlx database create
	cd server && sqlx migrate run
	cd utils && npm install && npm run build
	cd transport/client && npm run build
	cd client && npm install
	cd client && npm run build
	cd server && cargo build --release

run:
	cd server && ./target/release/server &

dev:
	cd server && cargo run

stop:
	pkill -f "target/release/server" || true

clean:
	cd client && rm -rf dist
	cd server && cargo clean
