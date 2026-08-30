FROM node:22-alpine
WORKDIR /app
COPY agent.mjs .
VOLUME /state
ENTRYPOINT ["node", "/app/agent.mjs"]
