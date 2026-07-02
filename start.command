#!/bin/sh
cd "$(dirname "$0")"
(sleep 2 && open "http://localhost:3477") &
npm start
