#include "SPI.h"
#include "Adafruit_GFX.h"
#include "Adafruit_ST7735.h"
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// ── Pin Definitions ──────────────────────────────────────────
#define TFT_CS        3
#define TFT_RST       5
#define TFT_DC        7
#define TFT_MOSI      6
#define TFT_SCK       4

// ── BLE UUIDs ────────────────────────────────────────────────
#define SERVICE_UUID        "12345678-1234-1234-1234-123456789abc"
#define CHARACTERISTIC_UUID "87654321-4321-4321-4321-cba987654321"

// ── TFT Object ───────────────────────────────────────────────
Adafruit_ST7735 tft = Adafruit_ST7735(TFT_CS, TFT_DC, TFT_MOSI, TFT_SCK, TFT_RST);

// ── BLE Objects ──────────────────────────────────────────────
BLEServer* pServer         = nullptr;
BLECharacteristic* pCharacteristic = nullptr;

// ── State (Global Variables) ─────────────────────────────────
bool    deviceConnected   = false;
bool    prevConnected     = false;
bool    firstDraw         = true;

// Variabel penampung hasil parsing data dasar
String currentSpeedStr    = "0.0";
String avgSpeedStr        = "0.0";
String batteryStr         = "100";
String clockStr           = "--:--";

// ── VARIABEL BARU FITUR NAVIGASI MAPS ──
String navIconStr         = "N"; // Default 'N' (None/Mati), L=Left, R=Right, S=Straight
String navDistStr         = "-";
String navStreetStr       = "-";

// Variabel tracker untuk mendeteksi perubahan data (anti-flicker)
String prevSpeedStr       = "";
String prevAvgStr         = "";
String prevBatteryStr     = "";
String prevClockStr       = "";
String prevNavIcon        = "";
String prevNavDist        = "";
String prevNavStreet      = "";

// ── Colors ───────────────────────────────────────────────────
#define BG_COLOR       0x0000  // Black
#define SPEED_COLOR    0x07FF  // Cyan
#define UNIT_COLOR     0x4208  // Gray
#define LABEL_COLOR    0xAD55  // Light Purple
#define CONN_COLOR     0x07E0  // Green
#define DISC_COLOR     0xF800  // Red
#define SCAN_COLOR     0xFFE0  // Yellow
#define BORDER_COLOR   0x2945  // Dark Gray

// ═══════════════════════════════════════════════════════════════
// BLE Server Callbacks
// ═══════════════════════════════════════════════════════════════
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) override {
    deviceConnected = true;
    Serial.println("[BLE] Client connected");
  }
  void onDisconnect(BLEServer* pServer) override {
    deviceConnected = false;
    Serial.println("[BLE] Client disconnected");
  }
};

// ═══════════════════════════════════════════════════════════════
// Characteristic Write Callback — Memecah 6 buah Pipa '|' (7 Parameters)
// ═══════════════════════════════════════════════════════════════
class CharacteristicCallbacks : public BLECharacteristicCallbacks {
  void onWrite(BLECharacteristic* pChar) override {
    String rxValue = pChar->getValue().c_str();
    
    if (rxValue.length() > 0) {
      Serial.print("[BLE] Raw data masuk: ");
      Serial.println(rxValue); 

      // Algoritma Parsing Berantai untuk Format Baru:
      // speed|avg|bat|time|nav_icon|nav_distance|nav_street
      int index1 = rxValue.indexOf('|');
      int index2 = rxValue.indexOf('|', index1 + 1);
      int index3 = rxValue.indexOf('|', index2 + 1);
      int index4 = rxValue.indexOf('|', index3 + 1);
      int index5 = rxValue.indexOf('|', index4 + 1);

      if (index1 != -1 && index2 != -1 && index3 != -1 && index4 != -1 && index5 != -1) {
        currentSpeedStr = rxValue.substring(0, index1);
        avgSpeedStr     = rxValue.substring(index1 + 1, index2);
        batteryStr      = rxValue.substring(index2 + 1, index3);
        clockStr        = rxValue.substring(index3 + 1, index4);
        navIconStr      = rxValue.substring(index4 + 1, index5);
        
        // Pemisah terakhir untuk mengambil data nama jalan target maps
        int index6 = rxValue.indexOf('|', index5 + 1);
        if (index6 != -1) {
          navDistStr   = rxValue.substring(index5 + 1, index6);
          navStreetStr = rxValue.substring(index6 + 1);
        } else {
          navDistStr   = rxValue.substring(index5 + 1);
          navStreetStr = "-";
        }

        // Pembersihan spasi gaib
        currentSpeedStr.trim();
        avgSpeedStr.trim();
        batteryStr.trim();
        clockStr.trim();
        navIconStr.trim();
        navDistStr.trim();
        navStreetStr.trim();
      }
    }
  }
};

// ═══════════════════════════════════════════════════════════════
// Display: Draw Static Layout (Header, label, border)
// ═══════════════════════════════════════════════════════════════
void drawLayout() {
  tft.fillScreen(BG_COLOR);
  
  // ── Top header bar background ───────────────────────────────
  tft.fillRect(0, 0, 128, 20, 0x1082); // Very dark blue-gray
  
  // ── Divider Atas & Bawah ────────────────────────────────────
  tft.drawFastHLine(0, 20, 128, BORDER_COLOR);
  tft.drawFastHLine(0, 108, 128, BORDER_COLOR);

  // ── Speed Label ─────────────────────────────────────────────
  tft.setTextColor(UNIT_COLOR);
  tft.setTextSize(1);
  tft.setCursor(48, 26);
  tft.print("SPEED");

  tft.setCursor(52, 95);
  tft.print("km/h");

  // ── Kotak Frame Utama ───────────────────────────────────────
  tft.drawRect(2, 22, 124, 84, BORDER_COLOR);

  firstDraw = false;
}

// ═══════════════════════════════════════════════════════════════
// Display: Draw Vector Arrow (Fungsi Penggambar Ikon Panah Navigasi)
// ═══════════════════════════════════════════════════════════════
void drawNavigationArrow(String type, int x, int y, uint16_t color) {
  // Bersihkan kotak ruang ikon panah (20x20 pixel)
  tft.fillRect(x, y, 20, 20, BG_COLOR);
  
  if (type == "R") { // Menggambar Panah Belok Kanan
    tft.drawFastHLine(x, y + 10, 16, color);
    tft.drawLine(x + 11, y + 5, x + 16, y + 10, color);
    tft.drawLine(x + 11, y + 15, x + 16, y + 10, color);
  } 
  else if (type == "L") { // Menggambar Panah Belok Kiri
    tft.drawFastHLine(x + 4, y + 10, 16, color);
    tft.drawLine(x + 9, y + 5, x + 4, y + 10, color);
    tft.drawLine(x + 9, y + 15, x + 4, y + 10, color);
  } 
  else if (type == "S") { // Menggambar Panah Lurus
    tft.drawFastVLine(x + 10, y + 4, 16, color);
    tft.drawLine(x + 5, y + 9, x + 10, y + 4, color);
    tft.drawLine(x + 15, y + 9, x + 10, y + 4, color);
  }
}

// ═══════════════════════════════════════════════════════════════
// Display: Update Dashboard Data (Anti-Flicker Screen Update)
// ═══════════════════════════════════════════════════════════════
void updateDashboardValues() {
  
  // 1. UPDATE JAM (Header Kiri)
  if (clockStr != prevClockStr || firstDraw) {
    prevClockStr = clockStr;
    tft.fillRect(4, 4, 35, 12, 0x1082); // Wipe area jam
    tft.setTextColor(LABEL_COLOR);
    tft.setTextSize(1);
    tft.setCursor(4, 6);
    tft.print(clockStr);
  }

  // 2. UPDATE BATERAI HP (Header Kanan)
  if (batteryStr != prevBatteryStr || firstDraw) {
    prevBatteryStr = batteryStr;
    tft.fillRect(80, 4, 44, 12, 0x1082); // Wipe area baterai
    tft.setTextColor(LABEL_COLOR);
    tft.setTextSize(1);
    
    int xPosBat = 124 - (batteryStr.length() * 6) - 12; 
    tft.setCursor(xPosBat, 6);
    tft.print(batteryStr);
    tft.print("%");
  }

  // 3. UPDATE CURRENT SPEED (Angka Besar di Tengah)
  if (currentSpeedStr != prevSpeedStr || firstDraw) {
    prevSpeedStr = currentSpeedStr;
    
    tft.fillRect(4, 38, 120, 52, BG_COLOR); // Wipe area angka tengah
    tft.setTextColor(SPEED_COLOR);

    int len = currentSpeedStr.length();
    int textSize, xPos;
    if (len <= 3) {
      textSize = 5; xPos = 16;
    } else if (len == 4) {
      textSize = 4; xPos = 10;
    } else {
      textSize = 3; xPos = 8;
    }

    tft.setTextSize(textSize);
    tft.setCursor(xPos, 40);
    tft.print(currentSpeedStr);
  }

  // 4. UPDATE AREA NAVIGASI MAPS & BARIS BAWAH (Koordinat Y: 110 - 130)
  if (navIconStr != prevNavIcon || navDistStr != prevNavDist || navStreetStr != prevNavStreet || firstDraw) {
    prevNavIcon   = navIconStr;
    prevNavDist   = navDistStr;
    prevNavStreet = navStreetStr;

    // Bersihkan seluruh baris info bawah sebelum di-render ulang
    tft.fillRect(2, 110, 124, 21, BG_COLOR); 

    if (navIconStr != "N") { 
      // A. JIKA NAVIGASI AKTIF: Gambar Panah & Teks Maps
      drawNavigationArrow(navIconStr, 4, 111, SPEED_COLOR);

      // Cetak Jarak Belokan (Misal: 250 m)
      tft.setTextColor(SCAN_COLOR);
      tft.setTextSize(1);
      tft.setCursor(28, 111);
      tft.print(navDistStr);

      // Cetak Nama Jalan Target
      tft.setTextColor(LABEL_COLOR);
      tft.setCursor(28, 121);
      
      // Pembatas karakter nama jalan agar tidak luber melewati lebar layar 128px
      if (navStreetStr.length() > 15) {
        tft.print(navStreetStr.substring(0, 13) + "..");
      } else {
        tft.print(navStreetStr);
      }
    } 
    else {
      // B. JIKA NAVIGASI MATI ('N'): Kembalikan layout ke tampilan AVG SPEED bawaan
      tft.setTextColor(UNIT_COLOR);
      tft.setTextSize(1);
      tft.setCursor(6, 114);
      tft.print("AVG:");
      
      tft.fillRect(32, 114, 90, 10, BG_COLOR);
      tft.setTextColor(SPEED_COLOR);
      tft.setCursor(32, 114);
      tft.print(avgSpeedStr);
      tft.setTextColor(UNIT_COLOR);
      tft.print(" km/h");
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Display: Update Connection Status (Paling Bawah)
// ═══════════════════════════════════════════════════════════════
void updateConnectionStatus(bool connected) {
  tft.fillRect(0, 132, 128, 28, BG_COLOR); 
  tft.setTextSize(1);
  
  if (connected) {
    tft.fillCircle(8, 142, 3, CONN_COLOR);
    tft.setTextColor(CONN_COLOR);
    tft.setCursor(18, 139);
    tft.print("CONNECTED");
  } else {
    tft.fillCircle(8, 142, 3, DISC_COLOR);
    tft.setTextColor(DISC_COLOR);
    tft.setCursor(18, 139);
    tft.print("WAITING PHONE...");
  }
}

// ═══════════════════════════════════════════════════════════════
// Setup
// ═══════════════════════════════════════════════════════════════
void setup() {
  Serial.begin(115200);
  Serial.println("[BOOT] ESP32 Bike Computer with Maps Ready...");

  // ── TFT Init ────────────────────────────────────────────────
  tft.initR(INITR_BLACKTAB);
  tft.setRotation(0);             // Portrait mode
  tft.fillScreen(BG_COLOR);

  Serial.println("[TFT] Display initialized");

  // ── Draw boot screen ─────────────────────────────────────────
  tft.setTextColor(SPEED_COLOR);
  tft.setTextSize(2);
  tft.setCursor(8, 50);
  tft.print("BIKE");
  tft.setCursor(8, 72);
  tft.print("COMPUTER");
  tft.setTextSize(1);
  tft.setTextColor(UNIT_COLOR);
  tft.setCursor(20, 105);
  tft.print("Initializing BLE...");
  delay(1500);

  // ── BLE Init ─────────────────────────────────────────────────
  BLEDevice::init("BikeComputer");

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_READ   |
    BLECharacteristic::PROPERTY_WRITE  |
    BLECharacteristic::PROPERTY_NOTIFY |
    BLECharacteristic::PROPERTY_WRITE_NR
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pCharacteristic->setCallbacks(new CharacteristicCallbacks());
  // Default values disesuaikan dengan format 7 parameter pipeline baru
  pCharacteristic->setValue("0.0|0.0|100|--:--|N|-|-");

  pService->start();

  BLEAdvertising* pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  Serial.println("[BLE] Advertising started. Device name: BikeComputer");

  // ── Draw main UI ─────────────────────────────────────────────
  drawLayout();
  updateDashboardValues();
  updateConnectionStatus(false);

  Serial.println("[BOOT] Ready!");
}

// ═══════════════════════════════════════════════════════════════
// Loop
// ═══════════════════════════════════════════════════════════════
void loop() {
  // ── Handle connection state changes ─────────────────────────
  if (deviceConnected != prevConnected) {
    if (deviceConnected) {
      updateConnectionStatus(true);
      Serial.println("[STATE] Phone connected!");
    } else {
      // Reset data ke default jika terputus dari HP
      currentSpeedStr = "0.0";
      avgSpeedStr     = "0.0";
      batteryStr      = "100";
      clockStr        = "--:--";
      navIconStr      = "N";
      navDistStr      = "-";
      navStreetStr    = "-";
      
      updateConnectionStatus(false);
      
      delay(500);
      pServer->startAdvertising();
      Serial.println("[STATE] Restarting advertising...");
    }
    prevConnected = deviceConnected;
  }

  // ── Update values ke layar ST7735 secara realtime ────────────
  updateDashboardValues();

  delay(50); // Kecepatan refresh loop 20Hz (Sangat responsif)
}
