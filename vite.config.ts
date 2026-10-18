import { defineConfig } from "vite-plus";

export default defineConfig({
	run: {
		cache: false,
		tasks: {
			// Compiles the forge plugin that writes command catalogues.
			"task:generate:plugin": {
				command: "forge-plugin build generator/plugin.ts -o generator/hl.wasm",
				cache: false,
			},
			// Runs forge on every bundled spec, through each service's overlay.
			"task:generate": {
				command: "node generate.ts",
				dependsOn: ["task:generate:plugin"],
				cache: false,
			},
			"task:check:type": {
				command: "tsgo --noEmit && tsgo --noEmit -p generator",
				cache: false,
			},
			"task:build": {
				command: "vp pack",
				dependsOn: ["task:generate"],
				cache: false,
			},
		},
	},
	pack: {
		entry: { index: "src/index.ts" },
		format: ["esm"],
		platform: "node",
		target: "node22",
		outDir: "dist",
		clean: true,
		sourcemap: false,
		minify: true,
	},
	test: {
		include: ["src/**/*.test.ts", "generator/**/*.test.ts"],
		testTimeout: 15_000,
		env: { TZ: "UTC" },
	},
	fmt: {
		useTabs: true,
		singleQuote: false,
		semi: true,
		printWidth: 120,
		ignorePatterns: ["specs/**", "src/services/*/_generated/**"],
	},
	lint: {
		plugins: ["typescript", "import", "unicorn"],
		categories: { correctness: "error" },
		options: { typeAware: true, typeCheck: false, denyWarnings: true },
		rules: {
			"typescript/no-explicit-any": "error",
			"typescript/no-non-null-assertion": "error",
			"typescript/consistent-type-imports": "error",
			"typescript/no-floating-promises": "error",
			curly: ["error", "all"],
		},
		ignorePatterns: ["src/services/*/_generated/**", "specs/**"],
	},
});
