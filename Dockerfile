FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .

RUN npx hardhat compile

FROM node:18-alpine

WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/hardhat.config.js ./
COPY --from=builder /app/contracts ./contracts
COPY --from=builder /app/scripts ./scripts
COPY --from=builder /app/artifacts ./artifacts
COPY --from=builder /app/cache ./cache

RUN apk add --no-cache python3 py3-pip git

EXPOSE 8545

CMD ["npx", "hardhat", "node"]