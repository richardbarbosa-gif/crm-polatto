# =====================================================================
# CRM Polatto — imagem de produção (SPA estática servida pelo `serve`).
#
# Base: Node 22 LTS em Alpine (a refinedev/node:18 anterior estava em fim
# de vida — sem correção de segurança desde 04/2025). Versão fixada para
# o build ser reproduzível; atualize a tag junto com o CI.
#
# Build (as variáveis VITE_* são PÚBLICAS — vão para o bundle do
# navegador; nunca passe a service_role aqui):
#   docker build \
#     --build-arg VITE_SUPABASE_URL=https://<ref>.supabase.co \
#     --build-arg VITE_SUPABASE_KEY=<chave anon/publishable> \
#     -t crm-polatto .
#   docker run -p 3000:3000 crm-polatto
#
# Cabeçalhos de segurança, fallback SPA e cache vêm de public/serve.json
# (copiado para a raiz do dist/ pelo Vite).
# =====================================================================
ARG NODE_IMAGE=node:22.23.4-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --no-audit --no-fund

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_KEY
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL} \
    VITE_SUPABASE_KEY=${VITE_SUPABASE_KEY}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_KEY" \
    || (echo "Informe --build-arg VITE_SUPABASE_URL e VITE_SUPABASE_KEY" && exit 1)
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN npm install -g serve@14.2.6 --no-audit --no-fund && npm cache clean --force
COPY --from=builder --chown=node:node /app/dist ./
# Usuário sem privilégio (já existe na imagem oficial do Node)
USER node
EXPOSE 3000
CMD ["serve", "--no-clipboard", "-l", "tcp://0.0.0.0:3000", "/app"]
