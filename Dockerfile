FROM node:22-alpine

WORKDIR /app

COPY --chown=node:node server.js index.html manifest.webmanifest start.bat ./
COPY --chown=node:node icons/ ./icons/

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- 'http://localhost:3000/sc?ping=1' || exit 1

USER node

CMD ["node", "server.js"]
