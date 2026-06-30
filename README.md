# ESP32 Bike Computer (Phone GPS Hub) 🚲💨

A lightweight, budget-friendly DIY smart bicycle computer built around the **ESP32** microcontroller. Instead of using a bulky and power-hungry dedicated hardware GPS module, this project utilizes your smartphone's GPS capabilities as a central hub, relaying live telemetry data seamlessly to the ESP32 display via wireless connectivity.


<img width="682" height="384" alt="Screenshot 2026-06-30 at 19 12 38" src="https://github.com/user-attachments/assets/bf738593-9d52-4583-85e4-209becd84196" />

---

## 🚀 Features
- **Phone GPS Integration:** Leverages the high-accuracy GPS on your phone to calculate speed, distance, and coordinates.
- **Real-time Telemetry Dashboard:** Displays crucial ride metrics instantly on the ESP32 screen.
- **Power Efficient:** Reduces battery consumption on the microcontroller by offloading heavy GNSS satellite tracking to the phone.
- **Wireless Sync:** Connects effortlessly via Bluetooth Low Energy (BLE) / Wi-Fi WebSockets.
- **Customizable UI:** Easily adaptable display layout for various display sizes and types.

---

## 🛠️ Hardware Requirements
To replicate this build, you will need:
1. **ESP32 Development Board** (e.g., ESP32-WROOM, ESP32-S3, or specialized smart displays like LilyGO/Waveshare).
2. **Display Module** (OLED/TFT/AMOLED depending on your setup).
3. **Power Source:** Compact power bank or
 LiPo battery setup.
4. **Smartphone:** Android or iOS device with location services enabled.

---

## 📐 How It Works
+-----------------+                 +------------------+
|   Smartphone    |  Location API   |      ESP32       |
|  (GPS Active)   | --------------> |  (Bike Computer) |
| Acts as Location|    Wireless     |  Displays Speed, |
|      Hub        |   (BLE)         |  Distance, Time  |
+-----------------+                 +------------------+

<img width="318" height="503" alt="Screenshot 2026-06-30 at 19 13 26" src="https://github.com/user-attachments/assets/1cacb344-810d-45aa-b8d8-0b3410bdd883" />


1. **The Hub (Phone):** The smartphone fetches real-time geolocation data (Latitude, Longitude, Speed, Heading) via the phone's native GPS.
2. **The Transmission:** Data is streamed continuously to the bike computer over a wireless protocol.
3. **The Dashboard (ESP32):** The ESP32 parses the received stream and renders the data onto the mounted display in an easily glanceable format.
