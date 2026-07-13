FROM node:20-alpine AS base
WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=optional

COPY tsconfig.json tsconfig.agent.json ./
COPY src ./src
COPY agent-dist ./agent-dist
RUN npx prisma generate
RUN npm run build
RUN npm run build:agent

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm install --omit=dev --omit=optional && npx prisma generate

COPY --from=base /app/dist ./dist
COPY --from=base /app/agent-dist ./agent-dist

EXPOSE 4000
CMD ["node", "dist/index.js"]
