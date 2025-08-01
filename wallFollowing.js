// wallFollowing.js - Roomba-specific wall following implementation
const { driveDirect } = require('./roombaCommands');

class RoombaWallFollowingController {
    constructor(port, io) {
        this.port = port;
        this.io = io;
        this.isActive = false;
        this.wallFollowInterval = null;
        this.currentState = 'SEARCHING'; // SEARCHING, FOLLOWING, CORNERING, BACKING_UP
        
        // Roomba-specific parameters
        this.targetWallDistance = 80; // Closer for better wall detection
        this.followSpeed = 80; // Slower, more manageable speed
        this.searchSpeed = 60; // Speed when searching for wall
        this.cornerSpeed = 40; // Very slow for corners
        
        // Wall following parameters
        this.wallLostThreshold = 20; // Wall signal below this = no wall
        this.tooCloseThreshold = 150; // Wall signal above this = too close
        this.cornerDetectionTime = 2000; // Time to try cornering before backing up
        
        // State tracking
        this.wallLostTime = null;
        this.cornerStartTime = null;
        this.lastWallSignal = 0;
        this.currentSensorData = null;
        
        // Corner handling
        this.isInCorner = false;
        this.cornerDirection = 'right'; // 'right' for right-wall following
        
        console.log('Roomba Wall Following Controller initialized');
    }

    updateSensorData(sensorData) {
        this.currentSensorData = sensorData;
        
        if (this.isActive && sensorData) {
            this.processWallFollowing(sensorData);
        }
    }

    start() {
        if (this.isActive) {
            console.log('Wall following already active');
            return false;
        }

        console.log('Starting Roomba wall following mode');
        this.isActive = true;
        this.currentState = 'SEARCHING';
        this.wallLostTime = null;
        this.cornerStartTime = null;
        this.isInCorner = false;
        
        this.io.emit('message', 'Roomba wall following mode ENABLED - Searching for wall');
        
        // Start the control loop
        this.wallFollowInterval = setInterval(() => {
            if (this.currentSensorData) {
                this.processWallFollowing(this.currentSensorData);
            }
        }, 150); // Slower update rate for more stable control
        
        return true;
    }

    stop() {
        if (!this.isActive) return false;

        console.log('Stopping Roomba wall following mode');
        this.isActive = false;
        
        if (this.wallFollowInterval) {
            clearInterval(this.wallFollowInterval);
            this.wallFollowInterval = null;
        }
        
        driveDirect(0, 0);
        this.io.emit('message', 'Roomba wall following mode DISABLED');
        return true;
    }

    processWallFollowing(sensorData) {
        // Always check safety first
        if (this.checkSafetyConditions(sensorData)) {
            return;
        }

        const wallSignal = sensorData.wallSignal;
        this.lastWallSignal = wallSignal;

        // State machine for different behaviors
        switch (this.currentState) {
            case 'SEARCHING':
                this.handleSearching(sensorData);
                break;
            case 'FOLLOWING':
                this.handleFollowing(sensorData);
                break;
            case 'CORNERING':
                this.handleCornering(sensorData);
                break;
            case 'BACKING_UP':
                this.handleBackingUp(sensorData);
                break;
        }

        // Send debug info
        this.sendDebugInfo(sensorData);
    }

    handleSearching(sensorData) {
        const wallSignal = sensorData.wallSignal;
        
        if (wallSignal > this.wallLostThreshold) {
            // Found a wall!
            console.log('Wall found! Switching to following mode');
            this.currentState = 'FOLLOWING';
            this.io.emit('message', 'Wall detected - Starting to follow');
            return;
        }

        // Keep searching - turn right slowly while moving forward
        driveDirect(this.searchSpeed, this.searchSpeed * 0.3);
        this.io.emit('message', 'Searching for wall...');
    }

    handleFollowing(sensorData) {
        const wallSignal = sensorData.wallSignal;
        
        // Check if we lost the wall
        if (wallSignal < this.wallLostThreshold) {
            if (!this.wallLostTime) {
                this.wallLostTime = Date.now();
            } else if (Date.now() - this.wallLostTime > 500) {
                // Wall lost for more than 500ms - might be a corner
                console.log('Wall lost - attempting corner navigation');
                this.currentState = 'CORNERING';
                this.cornerStartTime = Date.now();
                this.io.emit('message', 'Wall lost - Navigating corner');
                return;
            }
        } else {
            this.wallLostTime = null; // Reset wall lost timer
        }

        // Wall following logic
        let leftSpeed = this.followSpeed;
        let rightSpeed = this.followSpeed;

        if (wallSignal > this.tooCloseThreshold) {
            // Too close to wall - turn left (away from wall)
            leftSpeed = this.followSpeed * 0.6;
            rightSpeed = this.followSpeed;
        } else if (wallSignal < this.targetWallDistance && wallSignal > this.wallLostThreshold) {
            // Too far from wall - turn right (toward wall)
            leftSpeed = this.followSpeed;
            rightSpeed = this.followSpeed * 0.6;
        }
        // If we're in the sweet spot, just go straight

        driveDirect(rightSpeed, leftSpeed);
    }

    handleCornering(sensorData) {
        const wallSignal = sensorData.wallSignal;
        
        // Check if we found the wall again
        if (wallSignal > this.wallLostThreshold) {
            console.log('Wall found again after corner');
            this.currentState = 'FOLLOWING';
            this.cornerStartTime = null;
            this.io.emit('message', 'Corner navigated - Resuming wall following');
            return;
        }

        // Check if we've been trying to corner for too long
        if (Date.now() - this.cornerStartTime > this.cornerDetectionTime) {
            console.log('Corner navigation timeout - backing up');
            this.currentState = 'BACKING_UP';
            this.io.emit('message', 'Corner timeout - Backing up');
            return;
        }

        // Continue turning to navigate the corner
        // Turn right (clockwise) around the corner
        driveDirect(this.cornerSpeed * 0.3, this.cornerSpeed);
    }

    handleBackingUp(sensorData) {
        // Back up and turn to try a different approach
        driveDirect(-this.followSpeed * 0.8, -this.followSpeed * 0.8);
        
        // Back up for 1 second, then search again
        setTimeout(() => {
            if (this.isActive) {
                console.log('Finished backing up - searching for wall');
                this.currentState = 'SEARCHING';
                this.io.emit('message', 'Backup complete - Searching for wall');
            }
        }, 1000);
    }

    checkSafetyConditions(sensorData) {
        // Check for cliff sensors - immediate stop
        const cliffDetected = sensorData.cliffSensors && 
                             sensorData.cliffSensors.some(sensor => sensor < 1000);
        if (cliffDetected) {
            console.log('Cliff detected! Emergency stop');
            this.emergencyStop('Cliff detected');
            return true;
        }

        // Check for bump sensors
        if (sensorData.bumpLeft || sensorData.bumpRight) {
            console.log('Bump detected! Handling collision');
            this.handleBumpCollision(sensorData);
            return true;
        }

        // Check light bump sensors for gentler obstacle avoidance
        const lightBumpThreshold = 100;
        const strongBump = sensorData.bumpSensors && 
                          sensorData.bumpSensors.some(sensor => sensor > lightBumpThreshold);
        
        if (strongBump) {
            console.log('Light bump detected - gentle avoidance');
            this.handleLightBump(sensorData);
            return true;
        }

        return false;
    }

    handleBumpCollision(sensorData) {
        // Stop immediately
        driveDirect(0, 0);
        
        setTimeout(() => {
            if (!this.isActive) return;
            
            // Back up
            driveDirect(-60, -60);
            
            setTimeout(() => {
                if (!this.isActive) return;
                
                // Turn away from the bump
                if (sensorData.bumpLeft) {
                    // Hit on left, turn right
                    driveDirect(this.followSpeed * 0.3, this.followSpeed);
                } else {
                    // Hit on right or both, turn left
                    driveDirect(this.followSpeed, this.followSpeed * 0.3);
                }
                
                setTimeout(() => {
                    if (!this.isActive) return;
                    // Resume wall following
                    this.currentState = 'SEARCHING';
                    console.log('Resuming wall following after bump recovery');
                }, 1500);
                
            }, 1000);
        }, 500);
    }

    handleLightBump(sensorData) {
        // Gentle avoidance - just turn slightly away
        const avoidanceTime = 800;
        
        // Find which sensors are triggered
        const leftSide = sensorData.bumpSensors[0] + sensorData.bumpSensors[1] + sensorData.bumpSensors[2];
        const rightSide = sensorData.bumpSensors[3] + sensorData.bumpSensors[4] + sensorData.bumpSensors[5];
        
        if (leftSide > rightSide) {
            // More contact on left, turn right
            driveDirect(this.followSpeed * 0.4, this.followSpeed * 0.8);
        } else {
            // More contact on right, turn left
            driveDirect(this.followSpeed * 0.8, this.followSpeed * 0.4);
        }
        
        setTimeout(() => {
            if (this.isActive && this.currentState !== 'BACKING_UP') {
                // Resume previous state
                console.log('Light bump avoidance complete');
            }
        }, avoidanceTime);
    }

    emergencyStop(reason) {
        driveDirect(0, 0);
        this.stop();
        this.io.emit('alert', `Wall following emergency stop: ${reason}`);
    }

    sendDebugInfo(sensorData) {
        if (Date.now() % 1000 < 150) { // Every second roughly
            const debugInfo = {
                state: this.currentState,
                wallSignal: sensorData.wallSignal,
                targetDistance: this.targetWallDistance,
                followSpeed: this.followSpeed,
                bumpLeft: sensorData.bumpLeft,
                bumpRight: sensorData.bumpRight,
                lightBumps: sensorData.bumpSensors ? sensorData.bumpSensors.slice(0, 3).reduce((a,b) => a+b, 0) : 0
            };
            
            this.io.emit('wallFollowDebug', debugInfo);
        }
    }

    updateParameters(params) {
        if (params.targetDistance) this.targetWallDistance = params.targetDistance;
        if (params.followSpeed) this.followSpeed = params.followSpeed;
        if (params.searchSpeed) this.searchSpeed = params.searchSpeed;
        if (params.cornerSpeed) this.cornerSpeed = params.cornerSpeed;
        
        console.log('Roomba wall following parameters updated:', params);
        this.io.emit('message', 'Wall following parameters updated');
    }

    getStatus() {
        return {
            active: this.isActive,
            state: this.currentState,
            targetDistance: this.targetWallDistance,
            currentDistance: this.currentSensorData ? this.currentSensorData.wallSignal : null,
            parameters: {
                followSpeed: this.followSpeed,
                searchSpeed: this.searchSpeed,
                cornerSpeed: this.cornerSpeed,
                targetDistance: this.targetWallDistance
            }
        };
    }
}

module.exports = RoombaWallFollowingController;

// Integration code remains the same as before, just change:
// const WallFollowingController = require('./wallFollowing');
// to:
// const RoombaWallFollowingController = require('./wallFollowing');
// 
// And change the initialization to:
// const wallFollower = new RoombaWallFollowingController(port, io);