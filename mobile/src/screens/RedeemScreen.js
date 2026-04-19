import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { airtimeAPI } from '../services/api';

const RATE = 5; // 1 point = UGX 5
const MIN_POINTS = 100;

export default function RedeemScreen({ navigation }) {
  const { user, balance, refreshBalance } = useAuth();
  const [points, setPoints] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);

  const currentPoints = balance?.currentPoints ?? 0;
  const pointsNum = parseInt(points) || 0;
  const ugxValue = pointsNum * RATE;

  const handleRedeem = async () => {
    if (pointsNum < MIN_POINTS) return Alert.alert('Minimum', `You need at least ${MIN_POINTS} points to redeem.`);
    if (pointsNum > currentPoints) return Alert.alert('Insufficient', `You only have ${currentPoints} points.`);

    Alert.alert(
      'Confirm Redemption',
      `Convert ${pointsNum} points to UGX ${ugxValue.toLocaleString()} airtime?\n\nSent to: ${user?.phone}`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Redeem', onPress: doRedeem },
      ]
    );
  };

  const doRedeem = async () => {
    setLoading(true);
    try {
      const res = await airtimeAPI.redeem(pointsNum);
      setResult(res.data);
      await refreshBalance();
      setPoints('');
    } catch (err) {
      Alert.alert('Failed', err.response?.data?.error || 'Redemption failed. Points not deducted.');
    } finally {
      setLoading(false);
    }
  };

  const quickAmounts = [100, 200, 500, 1000];

  if (result) {
    return (
      <View style={styles.successContainer}>
        <View style={styles.successCard}>
          <Ionicons name="checkmark-circle" size={72} color="#2E7D32" />
          <Text style={styles.successTitle}>Airtime Sent!</Text>
          <Text style={styles.successAmount}>{result.redemption?.airtimeAmount}</Text>
          <Text style={styles.successPhone}>to {result.redemption?.phoneNumber}</Text>
          <View style={styles.successDetail}>
            <Text style={styles.detailLabel}>Points used</Text>
            <Text style={styles.detailValue}>{result.redemption?.pointsRedeemed}</Text>
          </View>
          <View style={styles.successDetail}>
            <Text style={styles.detailLabel}>Remaining balance</Text>
            <Text style={styles.detailValue}>{result.remainingPoints} pts</Text>
          </View>
          <TouchableOpacity style={styles.doneBtn} onPress={() => { setResult(null); navigation.goBack(); }}>
            <Text style={styles.doneBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Balance card */}
      <View style={styles.balanceCard}>
        <Text style={styles.balanceLabel}>Available Points</Text>
        <Text style={styles.balanceValue}>{currentPoints.toLocaleString()}</Text>
        <Text style={styles.balanceSub}>= UGX {(currentPoints * RATE).toLocaleString()} airtime</Text>
      </View>

      {/* Input */}
      <Text style={styles.inputLabel}>Points to redeem</Text>
      <TextInput
        style={styles.input}
        value={points}
        onChangeText={(v) => setPoints(v.replace(/[^0-9]/g, ''))}
        placeholder="Enter points (min 100)"
        keyboardType="numeric"
        placeholderTextColor="#999"
      />

      {/* Quick amounts */}
      <View style={styles.quickRow}>
        {quickAmounts.map((amt) => (
          <TouchableOpacity
            key={amt}
            style={[styles.quickBtn, pointsNum === amt && styles.quickBtnActive]}
            onPress={() => setPoints(String(amt))}
            disabled={amt > currentPoints}
          >
            <Text style={[styles.quickText, pointsNum === amt && styles.quickTextActive, amt > currentPoints && styles.quickTextDisabled]}>
              {amt}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Use all */}
      <TouchableOpacity onPress={() => setPoints(String(currentPoints))} disabled={currentPoints < MIN_POINTS}>
        <Text style={styles.useAll}>Use all {currentPoints} points</Text>
      </TouchableOpacity>

      {/* Conversion preview */}
      {pointsNum > 0 && (
        <View style={styles.preview}>
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>Points</Text>
            <Text style={styles.previewValue}>{pointsNum.toLocaleString()}</Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>Exchange rate</Text>
            <Text style={styles.previewValue}>1 pt = UGX {RATE}</Text>
          </View>
          <View style={styles.divider} />
          <View style={styles.previewRow}>
            <Text style={styles.previewLabelBold}>Airtime value</Text>
            <Text style={styles.previewValueBold}>UGX {ugxValue.toLocaleString()}</Text>
          </View>
          <View style={styles.previewRow}>
            <Text style={styles.previewLabel}>Sent to</Text>
            <Text style={styles.previewValue}>{user?.phone}</Text>
          </View>
        </View>
      )}

      {/* Redeem button */}
      <TouchableOpacity
        style={[styles.redeemBtn, (pointsNum < MIN_POINTS || pointsNum > currentPoints) && styles.redeemBtnDisabled]}
        onPress={handleRedeem}
        disabled={loading || pointsNum < MIN_POINTS || pointsNum > currentPoints}
      >
        {loading ? <ActivityIndicator color="#fff" /> : (
          <Text style={styles.redeemBtnText}>Redeem Airtime</Text>
        )}
      </TouchableOpacity>

      <Text style={styles.disclaimer}>Minimum redemption: {MIN_POINTS} points (UGX {MIN_POINTS * RATE})</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F0' },
  content: { padding: 20, paddingBottom: 40 },
  balanceCard: { backgroundColor: '#1B5E20', borderRadius: 16, padding: 24, alignItems: 'center', marginBottom: 24 },
  balanceLabel: { color: '#A5D6A7', fontSize: 13, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  balanceValue: { color: '#fff', fontSize: 48, fontWeight: '700', marginVertical: 4 },
  balanceSub: { color: '#A5D6A7', fontSize: 14 },
  inputLabel: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  input: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#ddd', borderRadius: 12, padding: 16, fontSize: 22, textAlign: 'center', fontWeight: '600', color: '#222' },
  quickRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 },
  quickBtn: { flex: 1, backgroundColor: '#fff', marginHorizontal: 4, borderRadius: 10, padding: 12, alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  quickBtnActive: { backgroundColor: '#2E7D32', borderColor: '#2E7D32' },
  quickText: { fontSize: 15, fontWeight: '600', color: '#333' },
  quickTextActive: { color: '#fff' },
  quickTextDisabled: { color: '#ccc' },
  useAll: { textAlign: 'center', color: '#2E7D32', fontWeight: '600', fontSize: 14, marginTop: 12 },
  preview: { backgroundColor: '#fff', borderRadius: 14, padding: 16, marginTop: 20 },
  previewRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  previewLabel: { fontSize: 14, color: '#888' },
  previewValue: { fontSize: 14, color: '#333' },
  previewLabelBold: { fontSize: 16, fontWeight: '700', color: '#222' },
  previewValueBold: { fontSize: 16, fontWeight: '700', color: '#2E7D32' },
  divider: { height: 1, backgroundColor: '#eee', marginVertical: 8 },
  redeemBtn: { backgroundColor: '#F57F17', borderRadius: 14, padding: 18, alignItems: 'center', marginTop: 24 },
  redeemBtnDisabled: { backgroundColor: '#ccc' },
  redeemBtnText: { color: '#fff', fontSize: 17, fontWeight: '700' },
  disclaimer: { textAlign: 'center', color: '#999', fontSize: 12, marginTop: 12 },
  // Success screen
  successContainer: { flex: 1, backgroundColor: '#F5F5F0', justifyContent: 'center', padding: 24 },
  successCard: { backgroundColor: '#fff', borderRadius: 20, padding: 32, alignItems: 'center' },
  successTitle: { fontSize: 24, fontWeight: '700', color: '#2E7D32', marginTop: 16 },
  successAmount: { fontSize: 36, fontWeight: '700', color: '#222', marginTop: 8 },
  successPhone: { fontSize: 14, color: '#888', marginTop: 4 },
  successDetail: { flexDirection: 'row', justifyContent: 'space-between', width: '100%', paddingVertical: 8, marginTop: 8, borderTopWidth: 1, borderTopColor: '#f0f0f0' },
  detailLabel: { fontSize: 14, color: '#888' },
  detailValue: { fontSize: 14, fontWeight: '600', color: '#333' },
  doneBtn: { backgroundColor: '#2E7D32', borderRadius: 12, paddingVertical: 14, paddingHorizontal: 40, marginTop: 24 },
  doneBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
