FROM python:3.14-slim

# Chromium — required by DrissionPage for OneLap browser-login sync
RUN apt-get update && apt-get install -y --no-install-recommends \
        chromium \
        chromium-driver \
        fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps before copying source (better layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Application source
COPY . .

# Persistent data dirs (mount these as volumes in production)
RUN mkdir -p input output

EXPOSE 5173

ENV FAFA_SERVER=1 \
    FAFA_PROXY_HOPS=1 \
    PYTHONUNBUFFERED=1 \
    FAFA_HOST=0.0.0.0 \
    FAFA_PORT=5173

CMD ["sh", "-c", "touch /app/users.db /app/config.json && mkdir -p /app/input && python app.py --server"]
