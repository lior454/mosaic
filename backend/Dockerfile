FROM node:20-alpine

# FFmpeg for video processing
RUN apk add --no-cache ffmpeg

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production
COPY . .
RUN npm run build

EXPOSE 3001
CMD ["node", "dist/index.js"]
