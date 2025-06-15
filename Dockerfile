FROM node:20-alpine

WORKDIR /usr/src/app

# Install Python3 and pip3
RUN apk add --no-cache bash wget python3 py3-pip dos2unix \
    && ln -sf python3 /usr/bin/python

# Install the required Python packages globally
RUN pip3 install requests beautifulsoup4 lxml pytz python-Levenshtein twilio --break-system-packages

# Copy package.json and package-lock.json for npm install
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Copy all project files
COPY . .

# # Globally install the JavaScript obfuscator
# RUN npm install -g javascript-obfuscator

# # Obfuscate JavaScript files excluding `node_modules`
# RUN find . -type f -name "*.js" ! -path "./node_modules/*" -exec javascript-obfuscator {} --output {} --options-preset high-obfuscation \;

# Expose the default application port
EXPOSE 80

# Run the entrypoint script
CMD ["node", "index.js"]
