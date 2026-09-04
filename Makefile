.PHONY: ui build

ui:
	cd ui && pnpm install --frozen-lockfile
	cd ui && pnpm build

build: ui
	cmake -B build -DCMAKE_BUILD_TYPE=Release
	cmake --build build --config Release --parallel
