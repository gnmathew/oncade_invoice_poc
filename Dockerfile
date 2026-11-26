# Recipe for the "app" container.
# Everything the app needs is installed INSIDE this container, not on your Mac.

# Start from an official image that already contains Node.js 24.
FROM node:24-alpine

# Work inside the /app folder of the container.
WORKDIR /app

# Create a folder for the database file, owned by the safe "node" user.
RUN mkdir -p /data && chown node:node /data

# Copy the list of libraries and install them (inside the container only).
COPY package*.json ./
RUN npm install

# Copy the app's source code and TypeScript settings.
COPY tsconfig.json ./
COPY src ./src

# Run as a normal user, not the all-powerful "root" user.
USER node

# The app listens on port 3000.
EXPOSE 3000

# Start the app. It restarts by itself whenever the source code changes.
CMD ["npm", "run", "dev"]
