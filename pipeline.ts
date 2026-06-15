import { definePipeline, job, sh, task, trigger } from "@async/pipeline";

const packageInputs = [
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "src/**/*.ts",
  "tests/**/*.js",
  "scripts/**/*.js",
  "README.md",
  "CHANGELOG.md",
  "api-contract.json",
  "API_SURFACE.md"
];

export default definePipeline({
  name: "async-json",
  cache: "file:local",
  triggers: {
    pr: trigger.github({ events: ["pull_request"] }),
    main: trigger.github({ events: ["push"], branches: ["main"] }),
    release: trigger.github({ events: ["release"] }),
    manual: trigger.manual()
  },
  sync: {
    github: {
      nodeVersion: 24,
      cache: true
    },
    tasks: {
      prefix: "pipeline",
      runners: ["package"],
      targets: [{ package: "@async/json" }],
      jobs: ["pages", "verify"],
      tasks: ["build", "test", "api-surface", "docs.site", "pack"],
      scripts: {
        "github:check": "github check",
        "github:generate": "github generate",
        "sync:check": "sync check",
        "sync:generate": "sync generate"
      }
    }
  },
  tasks: {
    build: task({
      description: "Compile the TypeScript package.",
      inputs: packageInputs,
      outputs: ["dist/**"],
      cache: true,
      run: sh`pnpm run build`
    }),
    test: task({
      description: "Run the package test suite.",
      dependsOn: ["build"],
      inputs: packageInputs,
      cache: true,
      run: sh`node --test tests/*.test.js`
    }),
    "api-surface": task({
      description: "Validate the @async/json API surface manifest and ledger.",
      inputs: ["api-contract.json", "API_SURFACE.md"],
      cache: true,
      run: sh`pnpm run api-surface:check`
    }),
    "docs.site": task({
      description: "Build the standardized GitHub Pages documentation site.",
      inputs: ["README.md", "API_SURFACE.md", "scripts/build-pages.js"],
      outputs: [".async/pages/**"],
      cache: false,
      run: sh`node scripts/build-pages.js`
    }),
    pack: task({
      description: "Verify the publishable package contents.",
      dependsOn: ["test", "api-surface"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm run pack:check`
    })
  },
  jobs: {
    verify: job({
      target: "pack",
      trigger: ["pr", "main", "release"]
    }),
    pages: job({
      target: "docs.site",
      trigger: ["pr", "main", "manual"],
      github: {
        pages: {
          build: { kind: "static", path: ".async/pages" }
        }
      }
    })
  }
});
