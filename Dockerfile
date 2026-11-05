# Runs the browser studio and Python tooling in a production container.


FROM node:22-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends python3 ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .

RUN npm run build && rm -rf .next/cache


ENV NODE_ENV=production \
    PORT=8080 \
    ROBOCRAFT_API=0 \
    ROBOCRAFT_DATA_DIR=/tmp/enginuity-data \
    ENGINUITY_BYOK=1 \
    ENGINUITY_DEFAULT_EXAMPLE=dual-robot-assembly \
    NEXT_TELEMETRY_DISABLED=1
EXPOSE 8080
CMD ["sh", "-c", "npx next start -H 0.0.0.0 -p ${PORT}"]
