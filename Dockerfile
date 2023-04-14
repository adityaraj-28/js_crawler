FROM node:18.15.0

RUN apt-get update
RUN apt-get install dialog

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN npx playwright install-deps
RUN chmod +x run.sh
ENV ENVIRONMENT=staging
ENTRYPOINT ["tail", "-f", "/dev/null"]