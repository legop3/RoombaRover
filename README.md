# RoombaRover
Control a 600 series roomba, or an IRobot Create 2 through a web browser

Designed for an SBC, like a Raspberry Pi, and an Arduino Uno for Serial and the BRC keep-alive pulse, so the Roomba doesn't go into sleep mode.

The `/Arduino` folder contains the code for pulling pin 8 of the Arduino Uno low for 1 second every minute. Install this code to your Arduino using Platform.io

By default, the script uses the serial port `/dev/ttyACM0` to communicate with the Roomba, and `/dev/video0` as the default webcam. Both of these can be changed by editing server.js to set the device paths for what you want to use.

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

If it runs well, move on to setting up a systemd service to make the server start when the Pi boots. This is important, as the interface includes an option to reboot the entire server.

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