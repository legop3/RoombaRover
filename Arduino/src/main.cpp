#include <Arduino.h>

const int pin = 8;

void setup() {
  pinMode(pin, OUTPUT);
  // digitalWrite(pin, HIGH); // Start with pin HIGH

  delay(2000);

  // set baud rate to 19200
  // digitalWrite(pin, HIGH);
  // delay(60);
  // digitalWrite(pin, LOW);
  // delay(60);

  // digitalWrite(pin, HIGH);
  // delay(60);
  // digitalWrite(pin, LOW);
  // delay(60);

  // digitalWrite(pin, HIGH);
  // delay(60);
  // digitalWrite(pin, LOW);
  // delay(1000);

}

void loop() {
  digitalWrite(pin, LOW);   // Pull pin 8 LOW
  delay(1000);              // Wait 1 second
  digitalWrite(pin, HIGH);  // Set pin 8 HIGH
  delay(59000);             // Wait remaining 59 seconds
}