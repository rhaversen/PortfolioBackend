# This dockerfile specifies the environment the production
# code will be run in, along with what files are needed
# for production

FROM node:24-bookworm-slim

ENV DEBIAN_FRONTEND=noninteractive

WORKDIR /app

RUN useradd -m portfolio_backend_user

COPY dist/app/ ./
COPY package*.json ./
COPY config/ ./config/

RUN chown -R portfolio_backend_user:portfolio_backend_user /app

USER portfolio_backend_user

RUN npm ci --omit=dev

EXPOSE 5001

CMD ["npm", "start"]
