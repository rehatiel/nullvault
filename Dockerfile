FROM node:20.19-alpine

RUN addgroup -S appgroup && adduser -S appuser -G appgroup

WORKDIR /app

COPY package*.json ./
RUN apk add --no-cache python3 make g++ \
    && npm install --omit=dev \
    && apk del python3 make g++

COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/

RUN mkdir -p /app/data && chown appuser:appgroup /app/data

USER appuser

EXPOSE 3000

CMD ["node", "src/app.js"]
