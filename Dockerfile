# Use official Node.js 20 image
FROM node:20-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy application code
COPY . .

# Run migrations before start
RUN node scripts/migrate.js || true

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "server.js"]
