FROM node:18.15.0-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN apk update && apk install  wget gnupg2
RUN wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apk add -
RUN echo "deb https://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list
RUN apk update && apk install google-chrome-stable
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/google-chrome-stable
RUN chmod +x run.sh
CMD ["./run.sh", "4", "0"]