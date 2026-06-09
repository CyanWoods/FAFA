FAFA_SERVER=1 ./venv/bin/gunicorn \
  --workers 4 \
  --bind 127.0.0.1:5173 \
  --timeout 120 \
  app:app
