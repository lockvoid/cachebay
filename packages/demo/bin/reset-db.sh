#!/bin/sh

mkdir -p /app/data

cp /app/vendor-template/harrypotter-origin.db /app/data/harrypotter.db

chmod 666 /app/data/harrypotter.db

echo "Database ready at $(date)"
