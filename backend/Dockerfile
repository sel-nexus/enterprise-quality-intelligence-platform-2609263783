FROM node:24-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --bin-links=false
COPY tsconfig.json ./
COPY src ./src
RUN node node_modules/typescript/bin/tsc -p tsconfig.json
ENV NODE_ENV=development PORT=3000 DATABASE_PATH=/data/eqip.sqlite
EXPOSE 3000
CMD ["node", "dist/src/main.js"]
