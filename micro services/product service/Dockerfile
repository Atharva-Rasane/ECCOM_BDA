# Development stage
FROM node:20.11.1-alpine AS development

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy source code
COPY . .

# Build TypeScript -> dist
RUN npm run build

# Expose port
EXPOSE 3000

# Start development server
CMD ["npm", "run", "dev:products"]

# Production stage
FROM node:20.11.1-alpine AS production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (dev deps needed for build)
RUN npm install

# Copy built application
COPY --from=development /app/dist ./dist
COPY --from=development /app/src ./src
COPY --from=development /app/views ./views
COPY --from=development /app/public ./public

# Expose port
EXPOSE 3000

# Start production server
CMD ["npm", "run", "start:products"]
