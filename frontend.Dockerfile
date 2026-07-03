FROM node:24-alpine

WORKDIR /workspace/frontend

ENV CHOKIDAR_USEPOLLING=true \
    WATCHPACK_POLLING=true \
    NG_POLL_INTERVAL=2000

EXPOSE 4200

CMD if [ ! -x node_modules/.bin/ng ]; then npm ci; fi \
    && printf '%s\n' \
      '{' \
      '  "/api": {' \
      '    "target": "http://backend:8080",' \
      '    "secure": false,' \
      '    "changeOrigin": false' \
      '  },' \
      '  "/health": {' \
      '    "target": "http://backend:8080",' \
      '    "secure": false,' \
      '    "changeOrigin": false' \
      '  },' \
      '  "/healthz": {' \
      '    "target": "http://backend:8080",' \
      '    "secure": false,' \
      '    "changeOrigin": false' \
      '  }' \
      '}' > /tmp/proxy.docker.conf.json \
    && npm run ng -- serve --host 0.0.0.0 --port 4200 --poll "${NG_POLL_INTERVAL}" --proxy-config /tmp/proxy.docker.conf.json
