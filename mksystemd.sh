#!/usr/bin/env bash

cd "$(dirname "$0")"

file=`mktemp`;

echo "writing to: $file";

cat <<eof >"$file"
[Unit]
Description=Roomba Rover Server Script
After=network.target

[Service]
WorkingDirectory=$PWD
ExecStart=$PWD/run.sh
Restart=on-failure
User=$(id -un)

[Install]
WantedBy=multi-user.target
eof

echo "created systemd service"
cat "$file"

echo "installing to system"
sudo mv -v $file /etc/systemd/system/roomba-rover.service

sudo systemctl enable roomba-rover.service
sudo systemctl start roomba-rover.service
sudo systemctl status roomba-rover.service
