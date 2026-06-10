FAFA_SERVER=1 FAFA_PROXY_HOPS="${FAFA_PROXY_HOPS:-1}" ./venv/bin/gunicorn \
  --workers 4 \
  --worker-class gthread \
  --threads 4 \
  --bind 127.0.0.1:5173 \
  --graceful-timeout 600 \
  --timeout 120 \
  app:app
