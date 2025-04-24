const { SerialPort } = require('serialport');

const port = new SerialPort({ path: '/dev/ttyACM0', baudRate: 115200 });

port.on('open', () => {
  console.log('Port opened');

  port.write([128])

  port.write([140, 0, 1, 28, 2])

  port.write([141, 0])
}
);
port.on('data', (data) => {
  console.log('Data received:', data.toString());
});
port.on('error', (err) => {
  console.error('Error:', err.message);
});