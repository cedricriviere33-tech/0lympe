FROM node:20-alpine
WORKDIR /app

# Dépendances (couche de cache)
COPY package.json ./
RUN npm install --omit=dev

# Code
COPY index.js ./

# Pas de port exposé : c'est un worker (écoute Supabase Realtime, pas de HTTP entrant)
CMD ["node", "index.js"]
