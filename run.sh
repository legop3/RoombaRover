#!/usr/bin/env bash

echo "cloning"
git clone https://github.com/legop3/RoombaRover.git
echo "starting..."
exec node server.js
