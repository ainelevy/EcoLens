import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { authAPI, airtimeAPI } from '../services/api';

export default function ProfileScreen() {
  const { user, balance, logout, refreshBalance } = useAuth();
  const [phone, setPhone] = useState(user?.phone || '');
  const [editing, setEditing] = useState(false);
  const [redemptions, setRedemptions] = useState([]);
  const [loaded, setLoaded] = useState(false);

  const RATE = 5;

  const savePhone = async () => {
    try {
      await authAPI.updatePhone(phone.trim());
      await refreshBalance();
      setEditing(false);
      Alert.alert('Updated', 'Phone number updated successfully.');
    } catch (err) {
      Alert.alert('Error', err.response?.data?.error || 'Failed to update phone');
    }
  };

  const loadRedemptions = async () => {
    try {
      const res = await airtimeAPI.getHistory();
      setRedemptions(res.data.redemptions || []);
      setLoaded(true);
    } catch {}
  };

  const handleLogout = () => {
    Alert.alert('Log Out', 'Are you sure you want to log out?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Log Out', style: 'destructive', onPress: logout },
    ]);
  };

  const infoRows = [
    { icon: 'person', label: 'Name', value: user?.name },
    { icon: 'mail', label: 'Email', value: user?.email },
    { icon: 'key', label: 'User Code', value: user?.userCode },
    { icon: 'calendar', label: 'Joined', value: new Date(user?.createdAt).toLocaleDateString('en-UG', { year: 'numeric', month: 'long', day: 'numeric' }) },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Avatar header */}
      <View style={styles.avatarSection}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{user?.name?.charAt(0)?.toUpperCase() || 'U'}</Text>
        </View>
        <Text style={styles.userName}>{user?.name}</Text>
        <Text style={styles.userCode}>{user?.userCode}</Text>
      </View>

      {/* Balance summary */}
      <View style={styles.balanceRow}>
        <View style={styles.balanceItem}>
          <Text style={styles.balanceNum}>{balance?.currentPoints ?? 0}</Text>
          <Text style={styles.balanceLabel}>Points</Text>
        </View>
        <View style={styles.balanceDivider} />
        <View style={styles.balanceItem}>
          <Text style={styles.balanceNum}>UGX {((balance?.currentPoints ?? 0) * RATE).toLocaleString()}</Text>
          <Text style={styles.balanceLabel}>Airtime Value</Text>
        </View>
      </View>

      {/* Info rows */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Account Information</Text>
        {infoRows.map((r, i) => (
          <View key={i} style={styles.infoRow}>
            <Ionicons name={r.icon} size={18} color="#2E7D32" style={{ marginRight: 12 }} />
            <Text style={styles.infoLabel}>{r.label}</Text>
            <Text style={styles.infoValue}>{r.value}</Text>
          </View>
        ))}
      </View>

      {/* Phone number (editable) */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Airtime Phone Number</Text>
        <View style={styles.phoneRow}>
          <Ionicons name="call" size={18} color="#2E7D32" style={{ marginRight: 12 }} />
          {editing ? (
            <>
              <TextInput style={styles.phoneInput} value={phone} onChangeText={setPhone} keyboardType="phone-pad" autoFocus />
              <TouchableOpacity onPress={savePhone} style={styles.saveBtn}>
                <Text style={styles.saveBtnText}>Save</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => { setEditing(false); setPhone(user?.phone || ''); }}>
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.phoneText}>{user?.phone}</Text>
              <TouchableOpacity onPress={() => setEditing(true)}>
                <Text style={styles.editText}>Edit</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        <Text style={styles.phoneHint}>Airtime redemptions are sent to this number</Text>
      </View>

      {/* Redemption history */}
      <View style={styles.section}>
        <TouchableOpacity onPress={loadRedemptions} style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>Redemption History</Text>
          {!loaded && <Text style={styles.loadText}>Tap to load</Text>}
        </TouchableOpacity>
        {loaded && redemptions.length === 0 && (
          <Text style={styles.emptyText}>No redemptions yet</Text>
        )}
        {redemptions.slice(0, 10).map((r, i) => (
          <View key={i} style={styles.redemptionRow}>
            <Ionicons name={r.status === 'successful' ? 'checkmark-circle' : 'close-circle'} size={18} color={r.status === 'successful' ? '#2E7D32' : '#C62828'} />
            <View style={{ flex: 1, marginLeft: 10 }}>
              <Text style={styles.redemptionAmt}>UGX {parseFloat(r.airtimeAmountUgx).toLocaleString()}</Text>
              <Text style={styles.redemptionDate}>{new Date(r.createdAt).toLocaleDateString('en-UG')}</Text>
            </View>
            <Text style={[styles.redemptionStatus, { color: r.status === 'successful' ? '#2E7D32' : '#C62828' }]}>
              {r.status}
            </Text>
          </View>
        ))}
      </View>

      {/* Logout */}
      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Ionicons name="log-out-outline" size={20} color="#C62828" />
        <Text style={styles.logoutText}>Log Out</Text>
      </TouchableOpacity>

      <Text style={styles.version}>EcoLens v1.0.0 | BSE4203 Group 6</Text>
      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F0' },
  content: { paddingBottom: 40 },
  avatarSection: { alignItems: 'center', paddingTop: 20, paddingBottom: 16 },
  avatar: { width: 72, height: 72, borderRadius: 36, backgroundColor: '#2E7D32', justifyContent: 'center', alignItems: 'center' },
  avatarText: { color: '#fff', fontSize: 32, fontWeight: '700' },
  userName: { fontSize: 20, fontWeight: '700', color: '#222', marginTop: 12 },
  userCode: { fontSize: 14, color: '#888', marginTop: 2 },
  balanceRow: { flexDirection: 'row', backgroundColor: '#fff', marginHorizontal: 16, borderRadius: 14, padding: 20, marginBottom: 8 },
  balanceItem: { flex: 1, alignItems: 'center' },
  balanceNum: { fontSize: 20, fontWeight: '700', color: '#2E7D32' },
  balanceLabel: { fontSize: 12, color: '#888', marginTop: 4 },
  balanceDivider: { width: 1, backgroundColor: '#eee' },
  section: { backgroundColor: '#fff', marginHorizontal: 16, marginTop: 12, borderRadius: 14, padding: 16 },
  sectionTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 12 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  loadText: { color: '#2E7D32', fontSize: 13, fontWeight: '600' },
  infoRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  infoLabel: { flex: 1, fontSize: 14, color: '#888' },
  infoValue: { fontSize: 14, fontWeight: '500', color: '#333' },
  phoneRow: { flexDirection: 'row', alignItems: 'center' },
  phoneText: { flex: 1, fontSize: 16, fontWeight: '500', color: '#333' },
  phoneInput: { flex: 1, fontSize: 16, borderBottomWidth: 1, borderBottomColor: '#2E7D32', paddingVertical: 4, color: '#333' },
  editText: { color: '#2E7D32', fontWeight: '600', fontSize: 14 },
  saveBtn: { backgroundColor: '#2E7D32', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6, marginLeft: 8 },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  cancelText: { color: '#999', fontWeight: '600', fontSize: 13, marginLeft: 10 },
  phoneHint: { fontSize: 12, color: '#999', marginTop: 8 },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', paddingVertical: 12 },
  redemptionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  redemptionAmt: { fontSize: 14, fontWeight: '600', color: '#222' },
  redemptionDate: { fontSize: 12, color: '#999' },
  redemptionStatus: { fontSize: 12, fontWeight: '600', textTransform: 'capitalize' },
  logoutBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', marginHorizontal: 16, marginTop: 20, borderRadius: 14, padding: 16 },
  logoutText: { color: '#C62828', fontWeight: '600', fontSize: 16, marginLeft: 8 },
  version: { textAlign: 'center', color: '#ccc', fontSize: 12, marginTop: 20 },
});
