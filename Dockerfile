FROM node:22-bookworm-slim

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production
ENV PORT=8002
ENV DATA_DIR=/data
VOLUME ["/data"]
EXPOSE 8002

CMD ["npm", "start"]
