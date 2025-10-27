# RoombaRover
Control a 600 series roomba, or an IRobot Create 2 through a web browser

### Features
- Live video from a server-side webcam
- Live audio from the server's microphone
- WASD control for desktop
- On-screen joystick for mobile


Designed for an SBC, like a Raspberry Pi to be attached to the Roomba, and to use an Arduino Uno for Serial and the BRC keep-alive pulse, so the Roomba doesn't go into sleep mode.

The `/Arduino` folder contains the code for pulling pin 8 of the Arduino Uno low for 1 second every minute. Install this code to your Arduino using Platform.io


# Raspberry Pi OS set-up
This section assumes you are using a Raspberry Pi, running Raspberry Pi OS. If you are using something else, you can probably figure out how to install this yourself anyway. :3

Clone this Repo into your home folder and navigate to the RoombaRover folder:

```cd && git clone https://github.com/legop3/RoombaRover && cd RoombaRover```

Install NodeJS, NPM, and FFMPEG:

```sudo apt install nodejs npm ffmpeg```

Install dependencies with NPM:

```npm install```

Try it out! (this is an easy way to see any errors that will be harder to deal with later):

```node server.js```



## Service files
If it runs well, move on to setting up a systemd service to make the server start when the Pi boots. This is important, as the interface includes an option to reboot the entire server.

### Display service
**Use this file if you have a display on the raspberry pi**

There is an example display service file included, `roomba-rover-display.service.example`. If your username is `pi`, you can just copy this file to `~/.config/systemd/user/roomba-rover-display.service`:

```cp roomba-rover-display.service.example ~/.config/systemd/user/roomba-rover-display.service```

If your username is not `pi`, you will need to edit the `WorkingDirectory=` parameter in order to make the service work.

Test your service using systemctl:

```systemctl --user start roomba-rover.service```

To check the service's status:

```systemctl --user status roomba-rover.service```

You will also want to try it out again and make sure it is actually functional when running in the service.

Once you know it works, enable the service so it will start when the Pi boots:

```systemctl --user enable roomba-rover.service```



### No-display service
**Use this file if you don't have a display on the raspberry pi**

There is an example systemd service file included, `roomba-rover.service.example`. If your username is `pi`, you can just copy this file to `/etc/systemd/system/roomba-rover.service`:

```sudo cp roomba-rover.service.example /etc/systemd/system/roomba-rover.service```

If your username is not `pi`, you will need to edit the `WorkingDirectory=` and `User=` parameters in order to make the service work.

Test your service using systemctl:

```sudo systemctl start roomba-rover.service```

To check the service's status:

```sudo systemctl status roomba-rover.service```

You will also want to try it out again and make sure it is actually functional when running in the service.

Once you know it works, enable the service so it will start when the Pi boots:

```sudo systemctl enable roomba-rover.service```

### Notes on WiFi
I am using a Raspberry Pi 3 for this, and it's built-in wifi adapter and PCB antenna are absolutely not good enough for this. I use an external USB wifi adapter which has a real antenna coming out of it, and it makes it much more useable.


# config.yaml

- serial
  - port
    
    The path for your serial port, something like `/dev/ttyACM0`
  - baudrate

    The baud rate to use when communicating with the Roomba. The default is `115200`, there is little reason to change this, but you can if you have to.
- express
  - port

    The port to use for the web server, the default is port `3000`
- mediamtx
  - videoStreamURL

    Viewer URL handed to the web UI; point it at whichever MediaMTX instance is serving WebRTC.
  - stunServers

    Optional list of STUN servers (e.g. `stun:stun.l.google.com:19302`) the rover advertises to WebRTC clients.
- camera
  - devicePath

    The device path for your camera. Usually something like `/dev/video0`
  - USBAddress

    The USB address of your webcam, only worry about this if the camera is USB. This is used to reset the webcam whenever the video is stopped. Maybe its just me but sometimes the webcam hangs and the video can't be restarted. This is usually something like `1415:2000`
- audio
  - device
  
    The device ID for your microphone, you can find this by using `arecord -l`. You will want to keep the `plughw:` and just change the `2,0` after it to the mapping of your own microphone.
- roverDisplay
  - enabled

    Set to `true` if you have a display attached to the pi on the Roomba, set to `false` if not.


# NOTES

ffmpeg camera to mediaMTX command:

audio / video:

`
ffmpeg \
 -fflags nobuffer -flags low_delay -use_wallclock_as_timestamps 1 \
 -thread_queue_size 512 \
 -f v4l2 -input_format h264 -framerate 30 -video_size 640x480 -i /dev/video2 \
 -thread_queue_size 512 \
 -f alsa -ac 1 -ar 48000 -i hw:2,0 \
 -map 0:v:0 -map 1:a:0 \
 -c:v copy \
 -c:a libopus -b:a 64k -ar 48000 -ac 1 -application lowdelay -frame_duration 20 \
 -muxdelay 0 -muxpreload 0 -max_interleave_delta 0 \
 -f rtsp -rtsp_transport tcp rtsp://127.0.0.1:8554/rover-video
`




# TODO
- [x] FIX autocharge
- [x] add a "one person per IP" mode, toggleable by admins (not per ip :( )
- [x] "charging complete" announcement on discord bot
- [x] Ping the "roomba watcher" role on announcements
- [x] modular, unified log outputs
- [x] play a sound when its your turn
- [x] when in admin mode, use fullscreen login page
- [x] when switching to admin mode, blank the screen for connected users
- [x] add a "lockdown" user and mode (for only me)
- [x] make tiny API endpoint for the discord link
- [ ] no-login admin monitoring page
- [x] add a collapsible room camera feed on top of right column
- [ ] SWITCH TO WEBRTC FOR AUDIO / VIDEO
