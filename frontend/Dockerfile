FROM node:24-bookworm-slim AS build
WORKDIR /source
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM nginx:1.29.1-alpine
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /source/dist /usr/share/nginx/html
RUN mkdir -p /tmp/nginx/client_temp /tmp/nginx/proxy_temp /tmp/nginx/fastcgi_temp /tmp/nginx/uwsgi_temp /tmp/nginx/scgi_temp \
    && chown -R nginx:nginx /tmp/nginx /usr/share/nginx/html
USER nginx
EXPOSE 8080
