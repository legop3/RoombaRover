// wallFollowing.js - Add this as a new module
const { driveDirect } = require('./roombaCommands');

class WallFollowingController {
    constructor(port, io) {
        this.port = port;
        this.io = io;
        this.isActive = false;
        this.wallFollowInterval = null;
        
        // PID Controller parameters for wall following
        this.targetWallDistance = 100; // Desired distance from wall (adjust based on your sensor readings)
        this.kp = 0.8; // Proportional gain
        this.ki = 0.1; // Integral gain  
        this.kd = 0.2; // Derivative gain
        
        // PID state variables
        this.previousError = 0;
        this.integral = 0;
        this.lastTime = Date.now();
        
        // Speed settings
        this.baseSpeed = 100; // Base forward speed
        this.maxTurnSpeed = 80; // Maximum turning speed
        
        // Sensor data storage
        this.currentSensorData = null;
        
        // Safety settings
        this.minWallDistance = 30; // Too close - turn away
        this.maxWallDistance = 200; // Too far - turn toward wall
        this.cliffThreshold = 1000; // Stop if cliff detected
        this.bumpStopTime = 2000; // Stop for 2 seconds if bump detected
        
        console.log('Wall Following Controller initialized');
    }

    // Update sensor data from your existing sensor stream
    updateSensorData(sensorData) {
        this.currentSensorData = sensorData;
        
        // If wall following is active, process the data
        if (this.isActive && sensorData) {
            this.processWallFollowing(sensorData);
        }
    }

    start() {
        if (this.isActive) {
            console.log('Wall following already active');
            return false;
        }

        console.log('Starting wall following mode');
        this.isActive = true;
        this.previousError = 0;
        this.integral = 0;
        this.lastTime = Date.now();
        
        this.io.emit('message', 'Wall following mode ENABLED');
        
        // Start the wall following loop
        this.wallFollowInterval = setInterval(() => {
            if (this.currentSensorData) {
                this.processWallFollowing(this.currentSensorData);
            }
        }, 100); // Run every 100ms for responsive control
        
        return true;
    }

    stop() {
        if (!this.isActive) {
            return false;
        }

        console.log('Stopping wall following mode');
        this.isActive = false;
        
        if (this.wallFollowInterval) {
            clearInterval(this.wallFollowInterval);
            this.wallFollowInterval = null;
        }
        
        // Stop the robot
        driveDirect(0, 0);
        
        this.io.emit('message', 'Wall following mode DISABLED');
        return true;
    }

    processWallFollowing(sensorData) {
        // Safety checks first
        if (this.checkSafetyConditions(sensorData)) {
            return; // Safety stop engaged
        }

        const wallDistance = sensorData.wallSignal;
        const currentTime = Date.now();
        const deltaTime = (currentTime - this.lastTime) / 1000; // Convert to seconds

        // Calculate PID error (how far we are from target distance)
        const error = this.targetWallDistance - wallDistance;

        // Update integral (accumulated error over time)
        this.integral += error * deltaTime;
        
        // Prevent integral windup
        const maxIntegral = 100;
        this.integral = Math.max(-maxIntegral, Math.min(maxIntegral, this.integral));

        // Calculate derivative (rate of change of error)
        const derivative = deltaTime > 0 ? (error - this.previousError) / deltaTime : 0;

        // PID output calculation
        const pidOutput = (this.kp * error) + (this.ki * this.integral) + (this.kd * derivative);

        // Convert PID output to wheel speeds
        const { leftSpeed, rightSpeed } = this.calculateWheelSpeeds(pidOutput, wallDistance);

        // Send drive command
        driveDirect(rightSpeed, leftSpeed);

        // Update state for next iteration
        this.previousError = error;
        this.lastTime = currentTime;

        // Debug output
        this.sendDebugInfo(wallDistance, error, pidOutput, leftSpeed, rightSpeed);
    }

    calculateWheelSpeeds(pidOutput, wallDistance) {
        // If no wall detected, search for wall
        if (wallDistance < 10) {
            return this.searchForWall();
        }

        // Base forward speed
        let leftSpeed = this.baseSpeed;
        let rightSpeed = this.baseSpeed;

        // Apply turning based on PID output
        // Positive PID output means we're too far from wall - turn right (toward wall)
        // Negative PID output means we're too close to wall - turn left (away from wall)
        
        const turnAdjustment = Math.max(-this.maxTurnSpeed, Math.min(this.maxTurnSpeed, pidOutput));

        if (turnAdjustment > 0) {
            // Turn right (toward wall)
            rightSpeed -= turnAdjustment;
        } else {
            // Turn left (away from wall)
            leftSpeed += turnAdjustment;
        }

        // Ensure speeds are within valid range
        leftSpeed = Math.max(-500, Math.min(500, leftSpeed));
        rightSpeed = Math.max(-500, Math.min(500, rightSpeed));

        return { leftSpeed, rightSpeed };
    }

    searchForWall() {
        // No wall detected - turn right slowly to search for wall
        console.log('Searching for wall...');
        this.io.emit('message', 'Searching for wall...');
        
        return {
            leftSpeed: 50,   // Slow forward
            rightSpeed: -20  // Turn right while moving forward
        };
    }

    checkSafetyConditions(sensorData) {
        // Check for cliff sensors
        const cliffDetected = sensorData.cliffSensors.some(sensor => sensor > this.cliffThreshold);
        if (cliffDetected) {
            console.log('Cliff detected! Stopping wall following.');
            this.emergencyStop('Cliff detected');
            return true;
        }

        // Check for bump sensors
        if (sensorData.bumpLeft || sensorData.bumpRight) {
            console.log('Bump detected! Backing up.');
            this.handleBumpRecovery(sensorData);
            return true;
        }

        // Check if wall is too close (emergency turn away)
        if (sensorData.wallSignal > 0 && sensorData.wallSignal < this.minWallDistance) {
            console.log('Too close to wall! Emergency turn.');
            driveDirect(-100, 100); // Turn left quickly
            return true;
        }

        return false;
    }

    handleBumpRecovery(sensorData) {
        // Stop immediately
        driveDirect(0, 0);
        
        setTimeout(() => {
            if (!this.isActive) return;
            
            // Back up
            driveDirect(-80, -80);
            
            setTimeout(() => {
                if (!this.isActive) return;
                
                // Turn away from the bump
                if (sensorData.bumpLeft) {
                    driveDirect(100, -50); // Turn right
                } else if (sensorData.bumpRight) {
                    driveDirect(-50, 100); // Turn left
                } else {
                    driveDirect(-50, 100); // Default turn left
                }
                
                setTimeout(() => {
                    if (!this.isActive) return;
                    // Resume normal operation
                    console.log('Resuming wall following after bump recovery');
                }, 1000);
                
            }, 1000); // Back up for 1 second
            
        }, 500); // Initial stop for 0.5 seconds
    }

    emergencyStop(reason) {
        driveDirect(0, 0);
        this.stop();
        this.io.emit('alert', `Wall following stopped: ${reason}`);
    }

    sendDebugInfo(wallDistance, error, pidOutput, leftSpeed, rightSpeed) {
        // Send debug info to clients every 10 iterations to avoid spam
        if (Date.now() % 1000 < 100) { // Roughly every second
            const debugInfo = {
                wallDistance,
                error: Math.round(error),
                pidOutput: Math.round(pidOutput),
                leftSpeed: Math.round(leftSpeed),
                rightSpeed: Math.round(rightSpeed),
                targetDistance: this.targetWallDistance
            };
            
            this.io.emit('wallFollowDebug', debugInfo);
        }
    }

    // Method to adjust parameters on the fly
    updateParameters(params) {
        if (params.targetDistance) this.targetWallDistance = params.targetDistance;
        if (params.kp !== undefined) this.kp = params.kp;
        if (params.ki !== undefined) this.ki = params.ki;
        if (params.kd !== undefined) this.kd = params.kd;
        if (params.baseSpeed) this.baseSpeed = params.baseSpeed;
        
        console.log('Wall following parameters updated:', params);
        this.io.emit('message', 'Wall following parameters updated');
    }

    getStatus() {
        return {
            active: this.isActive,
            targetDistance: this.targetWallDistance,
            currentDistance: this.currentSensorData ? this.currentSensorData.wallSignal : null,
            parameters: {
                kp: this.kp,
                ki: this.ki,
                kd: this.kd,
                baseSpeed: this.baseSpeed
            }
        };
    }
}

module.exports = WallFollowingController;

// Integration code for your server.js:

// Add this to your server.js imports:
// const WallFollowingController = require('./wallFollowing');

// Add this after your other initializations:
// const wallFollower = new WallFollowingController(port, io);

// Add this to your processPacket function (where you emit SensorData):
// wallFollower.updateSensorData({
//     wallSignal,
//     cliffSensors,
//     bumpLeft,
//     bumpRight,
//     // ... other sensor data
// });

// Add these socket handlers in your io.on('connection') block:
/*
socket.on('startWallFollowing', () => {
    if(!socket.authenticated) return socket.emit('alert', authAlert);
    
    const success = wallFollower.start();
    if (success) {
        socket.emit('message', 'Wall following started');
    } else {
        socket.emit('message', 'Wall following already active');
    }
});

socket.on('stopWallFollowing', () => {
    if(!socket.authenticated) return socket.emit('alert', authAlert);
    
    const success = wallFollower.stop();
    if (success) {
        socket.emit('message', 'Wall following stopped');
    }
});

socket.on('wallFollowingParams', (params) => {
    if(!socket.authenticated) return socket.emit('alert', authAlert);
    
    wallFollower.updateParameters(params);
});

socket.on('getWallFollowingStatus', () => {
    socket.emit('wallFollowingStatus', wallFollower.getStatus());
});
*/