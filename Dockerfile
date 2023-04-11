FROM node:18.15.0-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", ""]