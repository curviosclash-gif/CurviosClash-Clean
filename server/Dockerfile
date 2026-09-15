# Build from the repository root, because the server imports shared contracts
# from src/:
#   docker build -f server/Dockerfile -t curviosclash-signaling .
FROM node:20-alpine
WORKDIR /srv/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/signaling-server.js ./
# ../src/shared/contracts/... has to resolve from the server workdir, so the
# repository layout is mirrored one level above it.
COPY src/shared/contracts/ /srv/src/shared/contracts/
EXPOSE 9090
CMD ["node", "signaling-server.js"]
