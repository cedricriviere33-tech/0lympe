FROM node:20-alpine
WORKDIR /app

# Dépendances (couche de cache)
COPY package.json ./
RUN npm install --omit=dev

# Code
COPY index.js ./

# Serveur de santé (Coolify peut le health-check et le garde vivant)
EXPOSE 3000
ENV PORT=3000

CMD ["node", "index.js"]
