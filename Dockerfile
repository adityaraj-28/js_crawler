FROM node:18.15.0

RUN apt-get update
RUN apt-get install dialog
RUN apt-get -y install tmux

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx playwright install-deps
RUN chmod +x run.sh
ENV ENVIRONMENT=staging
ENV NODE_TLS_REJECT_UNAUTHORIZED=0
ENTRYPOINT ["tail", "-f", "/dev/null"]