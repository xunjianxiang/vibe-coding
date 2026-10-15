const cwd = __dirname;
const tsx = `${cwd}/node_modules/tsx/dist/cli.mjs`;
const common = {
  cwd,
  script: tsx,
  interpreter: process.execPath,
  exec_mode: "fork",
  instances: 1,
  autorestart: true,
  watch: false,
  restart_delay: 2_000,
  env: {
    NODE_ENV: "production",
    APP_ROOT: cwd,
  },
};

module.exports = {
  apps: [
    {
      ...common,
      name: "vibe-coding-web",
      args: ["server.ts", "--production"],
    },
    {
      ...common,
      name: "vibe-coding-runner",
      args: ["runner/index.ts", "start"],
    },
  ],
};
