FROM nginx:alpine

# Install openssl for SSL certificate generation
RUN apk add --no-cache openssl

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy SSL initialization script
COPY init-ssl.sh /docker-entrypoint.d/init-ssl.sh

# Make script executable
RUN chmod +x /docker-entrypoint.d/init-ssl.sh

# Expose ports
EXPOSE 80 443
