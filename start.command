#!/bin/sh
cd "$(dirname "$0")"
if [ ! -d "node_modules" ]; then
  npm install
fi
(sleep 2 && open "http://localhost:3477") &
npm start
