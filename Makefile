check-requirements:
	@echo "Checking system requirements..."
	@command -v node >/dev/null 2>&1 || { echo "Node.js is not installed. Please install Node.js"; exit 1; }
	@command -v npm >/dev/null 2>&1 || { echo "npm is not installed. Please install npm"; exit 1; }
	@command -v cargo >/dev/null 2>&1 || { echo "Rust/Cargo is not installed. Please install Rust"; exit 1; }
	@command -v sqlx >/dev/null 2>&1 || { echo "sqlx-cli is not installed. Please install with: cargo install sqlx-cli"; exit 1; }
	@test -f .env || { echo ".env file not found. Please copy .env.example to .env"; exit 1; }
	@echo "All requirements satisfied!"

install:
	npm install

build: check-requirements install
	sqlx database create
	cd server && sqlx migrate run
	npm run build
	cargo build --release

run:
	./target/release/server &

dev:
	cargo run -p opencord-server

stop:
	pkill -x server || true

clean:
	rm -rf client/dist
	cargo clean
