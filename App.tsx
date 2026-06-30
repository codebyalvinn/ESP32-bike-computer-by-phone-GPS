import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  PermissionsAndroid,
  Platform,
  Alert,
  StatusBar,
} from 'react-native';
import { BleManager, Device, Characteristic } from 'react-native-ble-plx';
import Geolocation from '@react-native-community/geolocation';
// FIX #1: Buffer sudah di-polyfill di index.js via global.Buffer
// Import ini tetap aman karena global sudah ada saat App di-load
import { Buffer } from 'buffer';
import DeviceInfo from 'react-native-device-info';

// FIX #5: Import RNNotificationListener dengan try-catch agar tidak crash
// jika library belum terinstall atau belum di-link dengan benar
let RNNotificationListener: any = null;
try {
  RNNotificationListener = require('react-native-notification-listener').default;
} catch (e) {
  console.warn('[NAV] react-native-notification-listener not available:', e);
}

// ── BLE Configuration ────────────────────────────────────────
const SERVICE_UUID        = '12345678-1234-1234-1234-123456789abc';
const CHARACTERISTIC_UUID = '87654321-4321-4321-4321-cba987654321';
const DEVICE_NAME         = 'BikeComputer';

// ── BLE Manager (singleton) ──────────────────────────────────
const bleManager = new BleManager();

// ── Connection States ────────────────────────────────────────
type ConnState = 'Disconnected' | 'Scanning' | 'Connected';

// ════════════════════════════════════════════════════════════════
// Main App Component
// ════════════════════════════════════════════════════════════════
export default function App(): React.JSX.Element {
  const [connState, setConnState]     = useState<ConnState>('Disconnected');
  const [speed, setSpeed]             = useState<number>(0.0);
  const [avgSpeed, setAvgSpeed]       = useState<number>(0.0);
  const [currentTime, setCurrentTime] = useState<string>('--:--');
  const [battery, setBattery]         = useState<number>(100);
  const [statusMsg, setStatusMsg]     = useState<string>('Press scan to start');

  // ── Navigation States ──────────────────────────────────────
  const [navIcon, setNavIcon]     = useState<string>('N');
  const [navDist, setNavDist]     = useState<string>('-');
  const [navStreet, setNavStreet] = useState<string>('-');

  const deviceRef         = useRef<Device | null>(null);
  const characteristicRef = useRef<Characteristic | null>(null);
  const gpsWatchIdRef     = useRef<number | null>(null);
  const speedHistoryRef   = useRef<number[]>([]);

  // ─────────────────────────────────────────────────────────────
  // FIX #6: Ref untuk semua data yang dipakai dalam BLE callback
  // ─────────────────────────────────────────────────────────────
  const speedRef      = useRef<number>(0.0);
  const avgSpeedRef   = useRef<number>(0.0);
  const batteryRef    = useRef<number>(100);
  const timeRef       = useRef<string>('--:--');
  const navIconRef    = useRef<string>('N');
  const navDistRef    = useRef<string>('-');
  const navStreetRef  = useRef<string>('-');

  // FIX #2: connStateRef untuk menghindari stale closure di setTimeout
  const connStateRef  = useRef<ConnState>('Disconnected');

  // Helper: update state + ref sekaligus dalam satu panggilan
  const setSpeedSync = useCallback((v: number) => {
    speedRef.current = v;
    setSpeed(v);
  }, []);
  const setAvgSpeedSync = useCallback((v: number) => {
    avgSpeedRef.current = v;
    setAvgSpeed(v);
  }, []);
  const setBatterySync = useCallback((v: number) => {
    batteryRef.current = v;
    setBattery(v);
  }, []);
  const setTimeSync = useCallback((v: string) => {
    timeRef.current = v;
    setCurrentTime(v);
  }, []);
  const setNavIconSync = useCallback((v: string) => {
    navIconRef.current = v;
    setNavIcon(v);
  }, []);
  const setNavDistSync = useCallback((v: string) => {
    navDistRef.current = v;
    setNavDist(v);
  }, []);
  const setNavStreetSync = useCallback((v: string) => {
    navStreetRef.current = v;
    setNavStreet(v);
  }, []);
  const setConnStateSync = useCallback((v: ConnState) => {
    connStateRef.current = v;
    setConnState(v);
  }, []);

  // ── GPS: Stop ─────────────────────────────────────────────
  const stopGps = useCallback(() => {
    if (gpsWatchIdRef.current !== null) {
      Geolocation.clearWatch(gpsWatchIdRef.current);
      gpsWatchIdRef.current = null;
      console.log('[GPS] Stopped');
    }
  }, []);

  // ── Cleanup on unmount ────────────────────────────────────
  useEffect(() => {
    return () => {
      stopGps();
      if (deviceRef.current) {
        deviceRef.current.cancelConnection().catch(() => {});
      }
      bleManager.destroy();
    };
  }, [stopGps]);

  // ════════════════════════════════════════════════════════════
  // BLE: Handle Disconnect
  // ════════════════════════════════════════════════════════════
  const handleDisconnect = useCallback(() => {
    console.log('[BLE] Disconnected');
    stopGps();
    deviceRef.current         = null;
    characteristicRef.current = null;
    setConnStateSync('Disconnected');
    setSpeedSync(0.0);
    setAvgSpeedSync(0.0);
    setNavIconSync('N');
    setNavDistSync('-');
    setNavStreetSync('-');
    speedHistoryRef.current = [];
    setStatusMsg('Disconnected. Tap Scan to reconnect.');
  }, [stopGps, setConnStateSync, setSpeedSync, setAvgSpeedSync, setNavIconSync, setNavDistSync, setNavStreetSync]);

  // ════════════════════════════════════════════════════════════
  // Permissions
  // ════════════════════════════════════════════════════════════
  const requestPermissions = useCallback(async (): Promise<boolean> => {
    if (Platform.OS !== 'android') {
      Alert.alert('Android Only', 'This app only supports Android.');
      return false;
    }

    try {
      const grants = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);

      const allGranted = Object.values(grants).every(
        g => g === PermissionsAndroid.RESULTS.GRANTED
      );

      if (!allGranted) {
        setStatusMsg('Permissions denied');
        Alert.alert('Permissions Required', 'Location and Bluetooth permissions are required.');
        return false;
      }

      if (!RNNotificationListener || typeof RNNotificationListener.hasPermission !== 'function') {
        console.warn('[NAV] Notification listener not available, skipping permission check');
        return true;
      }

      const isListenerEnabled = await RNNotificationListener.hasPermission();
      if (!isListenerEnabled) {
        Alert.alert(
          'Akses Notifikasi Diperlukan',
          'Mohon izinkan aplikasi membaca notifikasi agar rute Google Maps bisa dikirim ke ESP32.',
          [
            { text: 'Buka Pengaturan', onPress: () => RNNotificationListener.requestPermission() },
            { text: 'Batal', style: 'cancel' },
          ]
        );
        return true;
      }

      return true;
    } catch (err) {
      console.error('Permission error:', err);
      return false;
    }
  }, []);

  // ════════════════════════════════════════════════════════════
  // BLE: Send Data Package
  // Pipeline format: speed|avg|bat|time|nav_icon|nav_distance|nav_street
  // ════════════════════════════════════════════════════════════
  const sendDataPackage = useCallback(async (
    currentSpeed: number,
    avg: number,
    bat: number,
    timeStr: string,
    iconStr: string,
    distStr: string,
    streetStr: string
  ) => {
    if (!deviceRef.current || !characteristicRef.current) return;

    try {
      const value =
        `${currentSpeed.toFixed(1)}|` +
        `${avg.toFixed(1)}|` +
        `${bat}|` +
        `${timeStr}|` +
        `${iconStr}|` +
        `${distStr}|` +
        `${streetStr}`;

      const encoded = Buffer.from(value, 'utf-8').toString('base64');
      await characteristicRef.current.writeWithResponse(encoded);
      console.log(`[BLE] Sent -> ${value}`);
    } catch (err) {
      console.error('[BLE] Package delivery failed:', err);
      handleDisconnect();
    }
  }, [handleDisconnect]);

  // ════════════════════════════════════════════════════════════
  // GPS: watchPosition + Deadzone Anti-Noise
  // ════════════════════════════════════════════════════════════
  const startGps = useCallback(() => {
    if (gpsWatchIdRef.current !== null) return;

    console.log('[GPS] Starting watchPosition...');

    gpsWatchIdRef.current = Geolocation.watchPosition(
      position => {
        const rawSpeed = position.coords.speed ?? 0;
        let kmh = Math.max(0, rawSpeed * 3.6);

        if (kmh < 1.5) kmh = 0.0; // Deadzone anti-drift

        const rounded = Math.round(kmh * 10) / 10;
        speedHistoryRef.current.push(rounded);

        if (speedHistoryRef.current.length > 300) {
          speedHistoryRef.current.shift();
        }

        const sum = speedHistoryRef.current.reduce((a, b) => a + b, 0);
        const avg = sum / speedHistoryRef.current.length;

        setSpeedSync(rounded);
        setAvgSpeedSync(avg);

        sendDataPackage(
          rounded,
          avg,
          batteryRef.current,
          timeRef.current,
          navIconRef.current,
          navDistRef.current,
          navStreetRef.current
        );
      },
      error => {
        console.warn('[GPS] Error:', error.message);
        sendDataPackage(0.0, 0.0, batteryRef.current, timeRef.current, navIconRef.current, navDistRef.current, navStreetRef.current);
      },
      {
        enableHighAccuracy: true,
        distanceFilter: 0,
        interval: 1000,
        fastestInterval: 500,
        timeout: 10000,
      }
    );
  }, [sendDataPackage, setSpeedSync, setAvgSpeedSync]);

  // ════════════════════════════════════════════════════════════
  // Notification Listener — Sadap Google Maps (PERBAIKAN SENSITIVITAS)
  // ════════════════════════════════════════════════════════════
  useEffect(() => {
    if (Platform.OS !== 'android') return;

    // Pastikan library ter-load dengan benar
    const listenerModule = require('react-native-notification-listener');
    const actualListener = listenerModule.default || listenerModule;

    if (!actualListener || typeof actualListener.getNotificationListenerEvent !== 'function') {
      console.warn('[NAV] RNNotificationListener tidak tersedia di sistem.');
      return;
    }

    console.log('[NAV] Notification Listener berhasil diaktifkan.');

    const subscription = actualListener.getNotificationListenerEvent((notification: any) => {
      // Log mentah untuk debug di terminal, biar kelihatan kalau ada notifikasi masuk
      console.log('[NAV] Ada notifikasi masuk dari app:', notification?.app);

      if (!notification || notification.app !== 'com.google.android.apps.maps') return;

      const title = typeof notification.title === 'string' ? notification.title : '';
      const text  = typeof notification.text === 'string' ? notification.text : '';

      // Abaikan jika benar-benar kosong
      if (!title && !text) return;

      console.log(`[NAV] Berhasil Cegat Maps: [${title}] - [${text}]`);

      let parsedIcon   = 'S';
      let parsedDist   = '-';
      let parsedStreet = '-';

      const combinedText = `${title} ${text}`.toLowerCase();

      // 1. Penapis Arah Lebih Agresif
      if (combinedText.includes('kanan') || combinedText.includes('right')) {
        parsedIcon = 'R';
      } else if (combinedText.includes('kiri') || combinedText.includes('left')) {
        parsedIcon = 'L';
      } else if (
        combinedText.includes('lurus') || combinedText.includes('straight') ||
        combinedText.includes('bundaran') || combinedText.includes('roundabout') ||
        combinedText.includes('tetap di') || combinedText.includes('keep')
      ) {
        parsedIcon = 'S';
      } else {
        parsedIcon = 'N'; // Mode standby/idle jika tidak ada petunjuk arah baku
      }

      // 2. Ekstraksi Nama Jalan
      const streetSplitters = ['ke ', 'onto ', 'towards ', 'menuju ', 'di '];
      let splitFound = false;
      for (const splitter of streetSplitters) {
        if (text.includes(splitter)) {
          const parts = text.split(splitter);
          if (parts.length > 1 && parts[1]) {
            parsedStreet = parts[1].trim();
            splitFound = true;
            break;
          }
        }
      }
      
      if (!splitFound && text) {
        parsedStreet = text
          .replace(/Belok (kiri|kanan) ke /i, '')
          .replace(/Turn (left|right) onto /i, '')
          .replace(/Tetap di /i, '')
          .replace(/Keep (left|right|straight) /i, '');
      }
      
      if (parsedStreet && parsedStreet.length > 24) {
        parsedStreet = parsedStreet.substring(0, 21) + '...';
      }

      // 3. Ekstraksi Jarak (Mengutamakan teks penunjuk seperti "100 m" atau "2.5 km")
      const distRegex = /(\d+[\s]*(m|km|ft|mi|mile|miles))/i;
      const textDistMatch  = text.match(distRegex);
      const titleDistMatch = title.match(distRegex);

      if (titleDistMatch && titleDistMatch[0]) {
        parsedDist = titleDistMatch[0].trim();
      } else if (textDistMatch && textDistMatch[0]) {
        parsedDist = textDistMatch[0].trim();
      } else if (title && title !== 'Google Maps' && !title.includes('Navig')) {
        parsedDist = title;
      }

      // 4. Kondisi Akhir Rute
      if (combinedText.includes('sampai') || combinedText.includes('arrived') || combinedText.includes('selesai')) {
        parsedIcon   = 'N';
        parsedDist   = 'Arrived';
        parsedStreet = 'Finished';
      }

      // Update State UI Aplikasi
      setNavIconSync(parsedIcon);
      setNavDistSync(parsedDist);
      setNavStreetSync(parsedStreet);

      // Kirim otomatis ke ESP32 jika status terhubung
      if (connStateRef.current === 'Connected') {
        sendDataPackage(
          speedRef.current,
          avgSpeedRef.current,
          batteryRef.current,
          timeRef.current,
          parsedIcon,
          parsedDist,
          parsedStreet
        );
      }
    });

    return () => {
      if (subscription && typeof subscription.remove === 'function') {
        subscription.remove();
      }
    };
  }, [sendDataPackage, setNavIconSync, setNavDistSync, setNavStreetSync]);

  // ════════════════════════════════════════════════════════════
  // Clock Update — setiap detik, update UI saja
  // ════════════════════════════════════════════════════════════
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hh  = String(now.getHours()).padStart(2, '0');
      const mm  = String(now.getMinutes()).padStart(2, '0');
      setTimeSync(`${hh}:${mm}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [setTimeSync]);

  // ════════════════════════════════════════════════════════════
  // Battery Update — setiap 30 detik, update UI saja
  // ════════════════════════════════════════════════════════════
  useEffect(() => {
    const updateBattery = async () => {
      try {
        const level  = await DeviceInfo.getBatteryLevel();
        const batPct = Math.round(level * 100);
        setBatterySync(batPct);
      } catch (e) {
        console.warn('[Battery] Failed to get level:', e);
      }
    };
    updateBattery();
    const interval = setInterval(updateBattery, 30000);
    return () => clearInterval(interval);
  }, [setBatterySync]);

  // ════════════════════════════════════════════════════════════
  // BLE: Scan & Connect
  // ════════════════════════════════════════════════════════════
  const scanAndConnect = useCallback(async () => {
    const hasPerms = await requestPermissions();
    if (!hasPerms) return;

    setConnStateSync('Scanning');
    setStatusMsg(`Scanning for "${DEVICE_NAME}"...`);

    bleManager.startDeviceScan(null, null, async (error, device) => {
      if (error) {
        setConnStateSync('Disconnected');
        setStatusMsg(`Scan error: ${error.message}`);
        return;
      }

      if (!device) return;
      if (device.name !== DEVICE_NAME) return;

      bleManager.stopDeviceScan();
      setStatusMsg('Found! Connecting...');

      try {
        const connected   = await device.connect();
        const discovered  = await connected.discoverAllServicesAndCharacteristics();
        const chars       = await discovered.characteristicsForService(SERVICE_UUID);
        const speedChar   = chars.find(c => c.uuid === CHARACTERISTIC_UUID);

        if (!speedChar) throw new Error('Speed characteristic not found');

        deviceRef.current         = discovered;
        characteristicRef.current = speedChar;

        discovered.onDisconnected(() => { handleDisconnect(); });

        setConnStateSync('Connected');
        setStatusMsg('Connected to BikeComputer');
        startGps();

      } catch (err: any) {
        setConnStateSync('Disconnected');
        setStatusMsg(`Connection failed: ${err.message}`);
        deviceRef.current         = null;
        characteristicRef.current = null;
      }
    });

    setTimeout(() => {
      if (connStateRef.current === 'Scanning') {
        bleManager.stopDeviceScan();
        setConnStateSync('Disconnected');
        setStatusMsg('Scan timed out. Device not found.');
      }
    }, 15000);
  }, [requestPermissions, handleDisconnect, startGps, setConnStateSync]);

  // ════════════════════════════════════════════════════════════
  // Simulasi Navigasi (Test LCD)
  // ════════════════════════════════════════════════════════════
  const triggerSimulationNav = useCallback(async (direction: 'L' | 'R' | 'S') => {
    if (connStateRef.current !== 'Connected') {
      Alert.alert('Not Connected', 'Please connect to ESP32 first.');
      return;
    }

    const mockDist   = '250 m';
    const mockStreet =
      direction === 'R' ? 'Jl. Asia Afrika' :
      direction === 'L' ? 'Jl. Jend Sudirman' :
                          'Jl. Ir. H. Juanda';

    setNavIconSync(direction);
    setNavDistSync(mockDist);
    setNavStreetSync(mockStreet);

    await sendDataPackage(22.5, 17.8, batteryRef.current, timeRef.current, direction, mockDist, mockStreet);
    setStatusMsg(`Simulated ${direction} nav package sent!`);
  }, [sendDataPackage, setNavIconSync, setNavDistSync, setNavStreetSync]);

  // ════════════════════════════════════════════════════════════
  // Render
  // ════════════════════════════════════════════════════════════
  const statusColor =
    connState === 'Connected' ? '#00FF88' :
    connState === 'Scanning'  ? '#FFD700' :
                                '#FF4444';

  const isConnected = connState === 'Connected';

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      <View style={styles.header}>
        <Text style={styles.headerTitle}>BIKE COMPUTER</Text>
        <Text style={styles.headerSub}>GPS + NAV INTERCEPTOR → ESP32</Text>
      </View>

      <View style={styles.statusCard}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <View style={styles.statusTextContainer}>
          <Text style={[styles.statusState, { color: statusColor }]}>{connState}</Text>
          <Text style={styles.statusMsg} numberOfLines={2}>{statusMsg}</Text>
        </View>
      </View>

      <View style={styles.speedCard}>
        <Text style={styles.speedLabel}>CURRENT SPEED</Text>
        <View style={styles.speedRow}>
          <Text style={styles.speedValue}>{speed.toFixed(1)}</Text>
          <Text style={styles.speedUnit}>km/h</Text>
        </View>
      </View>

      <View style={styles.metaRow}>
        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>AVG SPEED</Text>
          <Text style={styles.metaValue}>
            {avgSpeed.toFixed(1)}{' '}
            <Text style={styles.metaSubUnit}>km/h</Text>
          </Text>
        </View>
        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>BATTERY</Text>
          <Text style={styles.metaValue}>{battery}%</Text>
        </View>
        <View style={styles.metaBox}>
          <Text style={styles.metaLabel}>CLOCK</Text>
          <Text style={styles.metaValue}>{currentTime}</Text>
        </View>
      </View>

      <View style={styles.navMonitorCard}>
        <Text style={styles.navMonitorTitle}>LIVE MAPS NOTIFICATION MONITOR</Text>
        <View style={styles.navMonitorBody}>
          <View style={styles.navDirectionBox}>
            <Text style={styles.navDirectionArrow}>
              {navIcon === 'R' ? '➔' : navIcon === 'L' ? '◀' : navIcon === 'S' ? '▲' : '•'}
            </Text>
            <Text style={styles.navDirectionText}>
              {navIcon === 'R' ? 'RIGHT' : navIcon === 'L' ? 'LEFT' : navIcon === 'S' ? 'STRAIGHT' : 'IDLE'}
            </Text>
          </View>
          <View style={styles.navDetailsBox}>
            <Text style={styles.navDataLabel}>DISTANCE: <Text style={styles.navDataText}>{navDist}</Text></Text>
            <Text style={styles.navDataLabel}>TARGET: <Text style={styles.navDataText} numberOfLines={1}>{navStreet}</Text></Text>
          </View>
        </View>
      </View>

      {connState === 'Disconnected' && (
        <TouchableOpacity style={[styles.btn, styles.btnScan]} onPress={scanAndConnect} activeOpacity={0.7}>
          <Text style={styles.btnText}>SCAN & CONNECT BIKE COMPUTER</Text>
        </TouchableOpacity>
      )}

      {isConnected && (
        <View style={styles.simPanel}>
          <Text style={styles.simPanelTitle}>TEST DISPLAY NAV PIPELINE</Text>
          <View style={styles.simButtonRow}>
            <TouchableOpacity style={[styles.btnSim, { backgroundColor: '#1a331a' }]} onPress={() => triggerSimulationNav('L')}>
              <Text style={styles.btnSimText}>◀ TEST KIRI</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnSim, { backgroundColor: '#1a331a' }]} onPress={() => triggerSimulationNav('S')}>
              <Text style={styles.btnSimText}>▲ LURUS</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.btnSim, { backgroundColor: '#1a331a' }]} onPress={() => triggerSimulationNav('R')}>
              <Text style={styles.btnSimText}>KANAN ▶</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      <View style={styles.footer}>
        <Text style={styles.footerText}>Pipeline Format: speed|avg|bat|time|icon|distance|street</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container:            { flex: 1, backgroundColor: '#0a0a0a', paddingHorizontal: 20, paddingTop: 16 },
  header:               { alignItems: 'center', marginBottom: 16, paddingTop: 8 },
  headerTitle:          { fontSize: 20, fontWeight: '800', color: '#00CFFF', letterSpacing: 4 },
  headerSub:            { fontSize: 10, color: '#555', letterSpacing: 2, marginTop: 4 },
  statusCard:           { flexDirection: 'row', alignItems: 'center', backgroundColor: '#141414', borderRadius: 12, padding: 12, marginBottom: 12, borderWidth: 1, borderColor: '#222' },
  statusDot:            { width: 10, height: 10, borderRadius: 5, marginRight: 12 },
  statusTextContainer:  { flex: 1 },
  statusState:          { fontSize: 13, fontWeight: '700', letterSpacing: 1 },
  statusMsg:            { fontSize: 10, color: '#666', marginTop: 2 },
  speedCard:            { backgroundColor: '#0d1a26', borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 12, borderWidth: 1, borderColor: '#1a3a5c' },
  speedLabel:           { fontSize: 10, color: '#4488aa', letterSpacing: 3, marginBottom: 4 },
  speedRow:             { flexDirection: 'row', alignItems: 'flex-end' },
  speedValue:           { fontSize: 72, fontWeight: '900', color: '#00CFFF', lineHeight: 78 },
  speedUnit:            { fontSize: 18, color: '#4488aa', marginBottom: 10, marginLeft: 6, fontWeight: '600' },
  metaRow:              { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  metaBox:              { flex: 1, backgroundColor: '#141414', borderRadius: 10, padding: 10, alignItems: 'center', marginHorizontal: 4, borderWidth: 1, borderColor: '#222' },
  metaLabel:            { fontSize: 8, color: '#666', letterSpacing: 1, marginBottom: 4, fontWeight: '700' },
  metaValue:            { fontSize: 14, fontWeight: '800', color: '#00CFFF' },
  metaSubUnit:          { fontSize: 8, color: '#4488aa', fontWeight: '400' },
  navMonitorCard:       { backgroundColor: '#141414', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#262626', marginBottom: 16 },
  navMonitorTitle:      { fontSize: 9, fontWeight: '700', color: '#FFD700', letterSpacing: 1, marginBottom: 8, textAlign: 'center' },
  navMonitorBody:       { flexDirection: 'row', alignItems: 'center' },
  navDirectionBox:      { alignItems: 'center', paddingRight: 16, borderRightWidth: 1, borderRightColor: '#222', minWidth: 70 },
  navDirectionArrow:    { fontSize: 24, fontWeight: 'bold', color: '#00CFFF' },
  navDirectionText:     { fontSize: 8, fontWeight: '600', color: '#666', marginTop: 2 },
  navDetailsBox:        { flex: 1, paddingLeft: 12, justifyContent: 'center' },
  navDataLabel:         { fontSize: 10, color: '#555', fontWeight: '700', marginBottom: 2 },
  navDataText:          { color: '#FFF', fontWeight: 'bold' },
  btn:                  { borderRadius: 10, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnScan:              { backgroundColor: '#0070CC' },
  btnText:              { color: '#FFFFFF', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  simPanel:             { backgroundColor: '#091409', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#143314' },
  simPanelTitle:        { fontSize: 9, color: '#00AA44', fontWeight: '700', textAlign: 'center', marginBottom: 8, letterSpacing: 1 },
  simButtonRow:         { flexDirection: 'row', justifyContent: 'space-between' },
  btnSim:               { flex: 1, marginHorizontal: 4, paddingVertical: 10, borderRadius: 6, alignItems: 'center', borderWidth: 1, borderColor: '#00AA44' },
  btnSimText:           { color: '#00FF88', fontSize: 10, fontWeight: '700' },
  footer:               { position: 'absolute', bottom: 10, left: 20, right: 20, alignItems: 'center' },
  footerText:           { fontSize: 8, color: '#262626', textAlign: 'center' },
});