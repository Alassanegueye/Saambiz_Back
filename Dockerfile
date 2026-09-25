# ── Stage 1 : dépendances de production ───────────────────────────────────────
FROM node:22-slim AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

# ── Stage 2 : image finale légère ─────────────────────────────────────────────
FROM node:22-slim

WORKDIR /app

# Copier les dépendances compilées depuis le stage précédent
COPY --from=deps /app/node_modules ./node_modules

# Copier le code source
COPY . .

# Utilisateur non-root pour limiter la surface d'attaque
RUN addgroup --system appgroup && adduser --system --ingroup appgroup appuser
USER appuser

EXPOSE 3000

# Healthcheck intégré (utilisé par docker-compose et les orchestrateurs)
# Le port est lu dans l'environnement, pas figé : les hébergeurs managés
# (Render, Fly, Cloud Run) imposent le leur via PORT. Figé à 3000, la sonde
# interrogeait un port sur lequel le serveur n'écoutait pas et le conteneur
# était marqué « unhealthy » alors qu'il répondait parfaitement.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "const p=process.env.PORT||3000;require('http').get('http://127.0.0.1:'+p+'/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "src/server.js"]
