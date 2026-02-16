# Development stage
FROM node:20.11.1-alpine AS development

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start development server with nodemon
CMD ["npm", "run", "dev"]

# Production stage
FROM node:20.11.1-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built application
COPY --from=development /app/dist ./dist
COPY --from=development /app/src ./src

# Expose port
EXPOSE 3000

# Start production server
CMD ["npm", "start"]
