console.log("Socket Global JS loaded");

var socket = io({
    // auth: {
    //     clientKey,
    // },
    // path: '/socket.io/',
    transports: ['websocket']
});

export { socket };