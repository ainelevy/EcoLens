import React, { useState, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Linking } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import { disposalAPI } from '../services/api';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Accepts either the kiosk payload "ecolens://kiosk?unit=<uuid>" or a bare UUID.
function parseUnitId(raw) {
  if (!raw) return null;
  const data = String(raw).trim();
  const m = data.match(/[?&]unit=([^&\s]+)/i);
  if (m && UUID_RE.test(m[1])) return m[1];
  if (UUID_RE.test(data)) return data;
  return null;
}

export default function ScannerScreen({ navigation }) {
  const { user } = useAuth();
  const [permission, requestPermission] = useCameraPermissions();

  // phase: 'scanning' | 'starting' | 'success' | 'error'
  const [phase, setPhase] = useState('scanning');
  const [message, setMessage] = useState('');
  const lockRef = useRef(false); // prevents duplicate scans firing the whole flow

  // Reset to a fresh scanning state every time the tab is focused.
  useFocusEffect(
    useCallback(() => {
      lockRef.current = false;
      setPhase('scanning');
      setMessage('');
      return () => { lockRef.current = true; };
    }, [])
  );

  const resetToScanning = () => {
    lockRef.current = false;
    setPhase('scanning');
    setMessage('');
  };

  const handleScan = async ({ data }) => {
    if (lockRef.current) return;
    lockRef.current = true;

    const unitId = parseUnitId(data);
    if (!unitId) {
      setPhase('error');
      setMessage("That doesn't look like an EcoLens kiosk code. Try again.");
      return;
    }

    if (!user?.userCode) {
      setPhase('error');
      setMessage('Your account has no user code. Please re-login and try again.');
      return;
    }

    setPhase('starting');
    try {
      // Make sure the kiosk exists and isn't full before starting.
      const statusRes = await disposalAPI.getKioskStatus(unitId);
      if (statusRes.data?.isFull) {
        setPhase('error');
        setMessage('This kiosk is full. Please use another unit or try again later.');
        return;
      }

      const res = await disposalAPI.startSession(user.userCode, unitId);
      setMessage(res.data?.message || 'Session started! Head to the kiosk and dispose your plastics.');
      setPhase('success');
    } catch (err) {
      const status = err?.response?.status;
      let msg = err?.response?.data?.error || 'Could not start a session. Please try again.';
      if (status === 404) msg = 'Kiosk not recognised. Make sure you scanned an EcoLens kiosk.';
      setPhase('error');
      setMessage(msg);
    }
  };

  // ── Permission states ────────────────────────────────────────────────
  if (!permission) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#2E7D32" />
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={64} color="#2E7D32" />
        <Text style={styles.permTitle}>Camera access needed</Text>
        <Text style={styles.permSub}>
          EcoLens uses your camera to scan the QR code on a disposal kiosk and start a session.
        </Text>
        {permission.canAskAgain ? (
          <TouchableOpacity style={styles.primaryBtn} onPress={requestPermission}>
            <Text style={styles.primaryBtnText}>Allow Camera</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={styles.primaryBtn} onPress={() => Linking.openSettings()}>
            <Text style={styles.primaryBtnText}>Open Settings</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  // ── Result overlays (success / error / starting) ─────────────────────
  if (phase !== 'scanning') {
    const isSuccess = phase === 'success';
    const isBusy = phase === 'starting';
    return (
      <View style={styles.center}>
        {isBusy ? (
          <>
            <ActivityIndicator size="large" color="#2E7D32" />
            <Text style={styles.permTitle}>Starting session…</Text>
          </>
        ) : (
          <>
            <View style={[styles.resultIcon, { backgroundColor: isSuccess ? '#E8F5E9' : '#FFEBEE' }]}>
              <Ionicons
                name={isSuccess ? 'checkmark-circle' : 'close-circle'}
                size={72}
                color={isSuccess ? '#2E7D32' : '#C62828'}
              />
            </View>
            <Text style={styles.permTitle}>{isSuccess ? 'Session Started!' : 'Scan Failed'}</Text>
            <Text style={styles.permSub}>{message}</Text>

            {isSuccess ? (
              <>
                <View style={styles.stepsBox}>
                  <Text style={styles.stepsLine}>1.  Go to the kiosk screen</Text>
                  <Text style={styles.stepsLine}>2.  Place a plastic bottle in view</Text>
                  <Text style={styles.stepsLine}>3.  Tap DISPOSE — earn points instantly</Text>
                </View>
                <TouchableOpacity style={styles.primaryBtn} onPress={() => navigation.navigate('Dashboard')}>
                  <Text style={styles.primaryBtnText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <TouchableOpacity style={styles.primaryBtn} onPress={resetToScanning}>
                <Text style={styles.primaryBtnText}>Scan Again</Text>
              </TouchableOpacity>
            )}
          </>
        )}
      </View>
    );
  }

  // ── Live scanner ─────────────────────────────────────────────────────
  return (
    <View style={styles.flex}>
      <CameraView
        style={StyleSheet.absoluteFill}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
        onBarcodeScanned={handleScan}
      />
      {/* Dark overlay with a clear cut-out frame */}
      <View style={styles.overlay}>
        <Text style={styles.title}>Scan Kiosk QR</Text>
        <Text style={styles.subtitle}>Point your camera at the code on the kiosk screen</Text>
        <View style={styles.frame}>
          <View style={[styles.corner, styles.tl]} />
          <View style={[styles.corner, styles.tr]} />
          <View style={[styles.corner, styles.bl]} />
          <View style={[styles.corner, styles.br]} />
        </View>
        <View style={styles.codePill}>
          <Ionicons name="person-circle-outline" size={16} color="#A5D6A7" />
          <Text style={styles.codePillText}>{user?.userCode ?? '------'}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: '#000' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F0', padding: 28 },
  overlay: { ...StyleSheet.absoluteFillObject, alignItems: 'center', justifyContent: 'center' },
  title: { position: 'absolute', top: 70, color: '#fff', fontSize: 22, fontWeight: '700' },
  subtitle: { position: 'absolute', top: 104, color: '#eee', fontSize: 13, textAlign: 'center', paddingHorizontal: 40 },
  frame: { width: 240, height: 240, justifyContent: 'space-between' },
  corner: { position: 'absolute', width: 36, height: 36, borderColor: '#2E7D32', borderWidth: 5 },
  tl: { top: 0, left: 0, borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 12 },
  tr: { top: 0, right: 0, borderLeftWidth: 0, borderBottomWidth: 0, borderTopRightRadius: 12 },
  bl: { bottom: 0, left: 0, borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 12 },
  br: { bottom: 0, right: 0, borderLeftWidth: 0, borderTopWidth: 0, borderBottomRightRadius: 12 },
  codePill: { position: 'absolute', bottom: 70, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: 'rgba(0,0,0,0.55)', paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20 },
  codePillText: { color: '#fff', fontSize: 14, fontWeight: '700', letterSpacing: 2 },
  // shared result / permission styles
  permTitle: { fontSize: 20, fontWeight: '700', color: '#1B5E20', marginTop: 18, textAlign: 'center' },
  permSub: { fontSize: 14, color: '#666', marginTop: 10, textAlign: 'center', lineHeight: 20 },
  resultIcon: { width: 110, height: 110, borderRadius: 55, justifyContent: 'center', alignItems: 'center' },
  stepsBox: { backgroundColor: '#fff', borderRadius: 14, padding: 18, marginTop: 22, width: '100%', gap: 10 },
  stepsLine: { fontSize: 14, color: '#333', fontWeight: '500' },
  primaryBtn: { backgroundColor: '#2E7D32', paddingVertical: 14, paddingHorizontal: 40, borderRadius: 12, marginTop: 24, minWidth: 200, alignItems: 'center' },
  primaryBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
