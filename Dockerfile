FROM node:22.19.0-slim

WORKDIR /app

# Copy workspace manifests before the source so dependency installation remains
# reproducible and Docker can cache this layer.
COPY package.json package-lock.json ./
COPY apps/dashboard/package.json apps/dashboard/package.json
COPY packages/cli/package.json packages/cli/package.json
COPY packages/comparison/package.json packages/comparison/package.json
COPY packages/report-contract/package.json packages/report-contract/package.json
COPY packages/scanner-core/package.json packages/scanner-core/package.json

RUN npm ci

COPY . .

RUN npm run build

CMD ["npm", "test"]
