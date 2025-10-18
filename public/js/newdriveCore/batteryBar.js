import {socket} from '../modules/socketGlobal.js';

var BATTERY_CAPACITY = 2068;
var BATTERY_WARNING = 1800;
var BATTERY_URGENT = 1700;

const batteryBars = Array.from(document.querySelectorAll('[data-battery-bar]'));
console.log(batteryBars);
var useable_capacity = BATTERY_CAPACITY - BATTERY_URGENT;
socket.on('batterybar:info', data => {
    console.log(`battery bar info. full:${data.full}, warning:${data.warning}, urgent:${data.urgent}`);
    BATTERY_CAPACITY = data.full;
    BATTERY_WARNING = data.warning;
    BATTERY_URGENT = data.urgent;

    useable_capacity = BATTERY_CAPACITY - BATTERY_URGENT;
});

socket.on('sensorData', data => {
    console.log(`battery level:${data.batteryCharge}`);
    const percent = Math.max(0, Math.min(100, (data.batteryCharge / BATTERY_CAPACITY)));

    console.log(`battery ${percent}% (${data.batteryCharge}/${useable_capacity})`);
    
})