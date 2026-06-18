import { definePipeline, env, job, sh, task, trigger } from "@async/pipeline";

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
      cache: true,
      packagePreviews: true,
      pages: { target: "docs.site" }
    },
    tasks: {
      prefix: "pipeline",
      runners: ["package"],
      targets: [{ package: "@async/json" }],
      jobs: ["publish", "publish-github", "release-doctor", "snapshot", "verify"],
      tasks: ["build", "test", "api-surface", "docs.site", "pack"],
      scripts: {
        "github:check": "github check",
        "github:generate": "github generate",
        "pages": "run-task docs.site",
        "publish": "run publish",
        "publish-github": "run publish-github",
        "publish:github:main": "publish github main --package .",
        "publish:github:pr": "publish github pr --package .",
        "publish:github:release": "publish github release --package .",
        "publish:npm": "publish npm --package .",
        "release:doctor": "release doctor --package .",
        "release:ensure": "release ensure --package .",
        "release-doctor": "run release-doctor",
        "snapshot": "run snapshot",
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
    }),
    snapshot: task({
      description: "Pushes to main publish an immutable GitHub Packages snapshot and move the main dist-tag while the commit is still branch head.",
      dependsOn: ["pack"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline publish github main --package .`
    }),
    "release-ensure": task({
      description: "Create or verify the release tag and GitHub Release before package publishing.",
      dependsOn: ["pack"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline release ensure --package .`
    }),
    "publish-github": task({
      description: "Stable GitHub Packages mirror for the release version before npm publishing.",
      dependsOn: ["release-ensure"],
      inputs: packageInputs,
      cache: false,
      run: sh`pnpm async-pipeline publish github release --package .`
    }),
    publish: task({
      description: "Publish the verified release to npm, then run release doctor.",
      dependsOn: ["publish-github"],
      inputs: packageInputs,
      cache: false,
      run: [
        sh`pnpm async-pipeline publish npm --package .`,
        sh`pnpm async-pipeline release doctor --package .`
      ]
    }),
    "release-doctor": task({
      description: "Diagnose release consistency for the current version.",
      dependsOn: ["pack"],
      cache: false,
      run: sh`pnpm async-pipeline release doctor --package .`
    })
  },
  jobs: {
    verify: job({
      target: "pack",
      trigger: ["pr", "main", "release"]
    }),
    snapshot: job({
      target: "snapshot",
      trigger: ["main"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write"
        }
      }
    }),
    "publish-github": job({
      target: "publish-github",
      trigger: ["manual"],
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write"
        }
      }
    }),
    publish: job({
      target: "publish",
      trigger: ["manual", "release"],
      environment: {
        name: "npm-publish",
        url: "https://www.npmjs.com/package/@async/json"
      },
      requires: {
        provenance: true
      },
      env: {
        NODE_AUTH_TOKEN: env.secret("npm_token"),
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      },
      github: {
        permissions: {
          contents: "write",
          packages: "write"
        }
      }
    }),
    "release-doctor": job({
      description: "Diagnose release consistency for the current version.",
      target: "release-doctor",
      trigger: ["manual"],
      github: {
        permissions: {
          contents: "read",
          packages: "read"
        }
      },
      env: {
        GITHUB_TOKEN: env.secret("GITHUB_TOKEN")
      }
    })
  }
});
