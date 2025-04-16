# Roomba Web Control

This project allows users to control a Roomba robot using a web interface. The web application listens for WASD key presses to send commands to the Roomba, and it also displays sensor data in real-time.

## Project Structure

```
roomba-web-control
├── public
│   ├── index.html        # HTML structure for the web page
│   ├── script.js         # Client-side JavaScript for user interaction
│   └── style.css         # CSS styles for the web page
├── src
│   ├── server.js         # Entry point for the server application
│   ├── roomba.js         # Logic for controlling the Roomba
│   └── sensors.js        # Logic for reading sensor data from the Roomba
├── package.json          # npm configuration file
└── README.md             # Project documentation
```

## Setup Instructions

1. **Clone the repository:**
   ```
   git clone <repository-url>
   cd roomba-web-control
   ```

2. **Install dependencies:**
   ```
   npm install
   ```

3. **Run the server:**
   ```
   npm start
   ```

4. **Open your web browser and navigate to:**
   ```
   http://localhost:3000
   ```

## Usage

- Use the **W** key to move forward.
- Use the **A** key to turn left.
- Use the **S** key to move backward.
- Use the **D** key to turn right.

The web interface will also display real-time sensor data from the Roomba.

## Dependencies

- Express: A web framework for Node.js.
- Socket.io: A library for real-time web applications.

## License

This project is licensed under the MIT License.