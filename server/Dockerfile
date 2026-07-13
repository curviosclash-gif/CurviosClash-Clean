FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY signaling-server.js ./
EXPOSE 9090
CMD ["node", "signaling-server.js"]
