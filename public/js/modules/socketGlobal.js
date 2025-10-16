console.log("Socket Global JS loaded");

var socket = io({
    // auth: {
    //     clientKey,
    // },
    // path: '/socket.io/',
    transports: ['websocket']
});

socket.on('connect', () => {
    document.getElementById('connectstatus').innerText = 'Connected'
    document.getElementById('connectstatus').classList.remove('bg-red-500')
    document.getElementById('connectstatus').classList.add('bg-green-500')
});

socket.on('disconnect', () => {
    document.getElementById('connectstatus').innerText = 'Disconnected'
    document.getElementById('connectstatus').classList.remove('bg-green-500')
    document.getElementById('connectstatus').classList.add('bg-red-500')
});

export { socket };