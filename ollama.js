// You are controlling a robot exploring a new environment. Be curious. Based on the image from the robot’s camera, what direction should the robot go? use instructions like [forward] [backward] to move the robot forward and backward, and [left] and [right] to steer the robot left and right (tank steering). only state commands if you want the robot to follow them. 

const {driveDirect, playRoombaSong} = require('./roombaCommands');
const port = require('./serialPort');