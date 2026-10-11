FROM node:20-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY src ./src
USER node
CMD ["node", "src/index.js"]
