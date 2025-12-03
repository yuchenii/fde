FROM oven/bun:1-alpine

# Install necessary tools
RUN apk add --no-cache \
    util-linux \
    bash \
    unzip \
    openssh-client

# Create app directory
WORKDIR /app

# Copy package files first for better caching
COPY package.json bun.lock ./

# Install production dependencies
RUN bun install --production

# Copy source code
COPY . .

# Create logs and deploy directory
RUN mkdir -p logs

# Expose port
EXPOSE 3000

# Start command
# Use ENTRYPOINT for the fixed command and CMD for default arguments
# This allows you to pass extra arguments to `docker run` easily
ENTRYPOINT ["bun", "run", "src/server/index.ts", "start"]
CMD ["-c", "server.yaml"]
