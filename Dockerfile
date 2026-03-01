FROM node:20-alpine AS dashboard-build

WORKDIR /dashboard
COPY dashboard/package.json dashboard/package-lock.json* ./
RUN npm ci
COPY dashboard/ .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --production

COPY . .
COPY --from=dashboard-build /dashboard/dist ./dashboard/dist

EXPOSE 3000

CMD ["node", "src/server.js"]
