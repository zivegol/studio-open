FROM mcr.microsoft.com/playwright:v1.63.0-noble
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts && npm cache clean --force
COPY . ./
ENV NODE_ENV=production
USER pwuser
EXPOSE 8787
CMD ["node", "server.mjs"]
