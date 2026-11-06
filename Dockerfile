FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY index.html vite.config.js ./
COPY src ./src
COPY server ./server
# Producción no incluye el seed con datos de la vista privada.
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production DATA_MODE=sheets HOST=0.0.0.0 PORT=8080
WORKDIR /app
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/domain.js ./src/domain.js
COPY --from=build /app/src/demo.js ./src/demo.js
USER node
EXPOSE 8080
CMD ["node", "server/index.js"]
