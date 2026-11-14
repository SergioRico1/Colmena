# The machine of a hosted workspace (docs/CLOUD.md › Phase 4): one container per company, started on
# demand by the Machine Durable Object (cloud/src/machine.js) and stopped when idle. It runs
# server/machine/serve.mjs: «Código» (git worktrees, terminals, engines), run_command, project dev
# servers and LibreOffice for Office→PDF previews. Built by wrangler from the repository root
# (build_context = ".." in cloud/wrangler.toml); what it copies is listed in Dockerfile.dockerignore.
FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      git gh ca-certificates lsof procps tar gzip python3 make g++ \
      libreoffice-writer-nogui libreoffice-calc-nogui libreoffice-impress-nogui \
      fonts-dejavu-core fonts-liberation2 fonts-crosextra-carlito fonts-crosextra-caladea \
 && rm -rf /var/lib/apt/lists/*

# The code engines, driven with each person's own API key (never a subscription sign-in).
RUN npm install -g @openai/codex@0.166.0 @anthropic-ai/claude-code@2.1.314 opencode-ai@1.19.5 \
 && npm cache clean --force

WORKDIR /app
COPY package.json package-lock.json ./
# Runtime dependencies only; node-pty is built for this Linux (the «Código» terminal).
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund \
 && npm rebuild node-pty \
 && npm cache clean --force
COPY server ./server
COPY prompts ./prompts
COPY cloud/container/fake-claude-code.mjs ./cloud/container/fake-claude-code.mjs

# GitHub over https with the token the request brought (GH_TOKEN, set by the machine server per
# request): git asks this helper, gh reads the variable itself. No token is ever written to disk.
RUN git config --system user.email "bruno@colmena.invalid" \
 && git config --system user.name "Colmena" \
 && git config --system init.defaultBranch main \
 && git config --system --add safe.directory "*" \
 && git config --system credential.https://github.com.helper '!f() { test -n "$GH_TOKEN" && echo username=x-access-token && echo "password=$GH_TOKEN"; }; f'

ENV HOME=/work MACHINE_WORK=/work MACHINE_PORT=8080 NODE_ENV=production LANG=C.UTF-8
EXPOSE 8080
CMD ["node", "server/machine/serve.mjs"]
