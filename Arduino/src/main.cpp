#include <Arduino.h>
#include <SoftwareSerial.h>

#define SERIAL_RX_PIN 10
#define SERIAL_TX_PIN 11
#define PULSE_PIN 8
#define PULSE_INTERVAL 270000UL // 4.5 minutes in ms
#define PULSE_DURATION 1000UL   // 1 second in ms

SoftwareSerial serialPins(SERIAL_RX_PIN, SERIAL_TX_PIN);

unsigned long lastPulse = 0;
bool pulsing = false;
unsigned long pulseStart = 0;

void setup() {
    Serial.begin(115200);
    serialPins.begin(115200);
    pinMode(PULSE_PIN, OUTPUT);
    digitalWrite(PULSE_PIN, HIGH); // Default HIGH
}

void loop() {
    // Forward USB Serial to serial pins
    while (Serial.available()) {
        serialPins.write(Serial.read());
    }
    // Forward serial pins to USB Serial (optional)
    while (serialPins.available()) {
        Serial.write(serialPins.read());
    }

    unsigned long now = millis();

    if (!pulsing && now - lastPulse >= PULSE_INTERVAL) {
        digitalWrite(PULSE_PIN, LOW);
        pulsing = true;
        pulseStart = now;
    }
    if (pulsing && now - pulseStart >= PULSE_DURATION) {
        digitalWrite(PULSE_PIN, HIGH);
        pulsing = false;
        lastPulse = now;
    }
}