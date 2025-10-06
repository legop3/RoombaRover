# plans for implementing the "turns" system

1. make the viewer into a different section of sockets somehow - DONE!
   - so that it doesn't count as a user who is online, and isn't subject to access control at all. 

2. create global access control system
   - redo publicMode.js. there is no longer just "public" or "private" modes.
   - admins can do everything
   - admins always have a way to log in
   - only admins can reboot the server
   - sockets can be allowed or un-allowed to drive
   - no mode stuff in this file, just managing access.

3. the new access mode system
   - 3 modes: "admin only" "turns" and "open play"
   - admins can switch between modes
   - modes are broadcast to both program and users

4. the actual turns system
   - non-admin socket are cycled through
   - each socket gets a certain amount of time to drive
   - uses the access control system to allow / disallow sockets from driving
   - a socket's turn ends when they disconnect, despite the timer