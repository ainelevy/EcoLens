import React, { useState, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../context/AuthContext';
import { disposalAPI } from '../services/api';
import { useFocusEffect } from '@react-navigation/native';

export default function DashboardScreen({ navigation }) {
  const { user, balance, refreshBalance } = useAuth();
  const [stats, setStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  const loadData = async () => {
    try {
      const res = await disposalAPI.getStats();
      setStats(res.data);
    } catch {}
    await refreshBalance();
    setLoading(false);
  };

  useFocusEffect(useCallback(() => { loadData(); }, []));

  const onRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#2E7D32" /></View>;

  const cards = [
    { icon: 'leaf', color: '#2E7D32', label: 'Current Points', value: balance?.currentPoints ?? 0 },
    { icon: 'cash', color: '#F57F17', label: 'Airtime Value', value: balance?.airtimeEquivalent ?? 'UGX 0' },
    { icon: 'trash-bin', color: '#1565C0', label: 'Items Recycled', value: stats?.acceptedItems ?? 0 },
    { icon: 'analytics', color: '#6A1B9A', label: 'Acceptance Rate', value: stats?.acceptanceRate ?? '0%' },
  ];

  return (
    <ScrollView style={styles.container} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2E7D32']} />}>
      {/* Welcome header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.greeting}>Welcome back,</Text>
          <Text style={styles.name}>{user?.name?.split(' ')[0] ?? 'User'}</Text>
        </View>
        <TouchableOpacity style={styles.profileBtn} onPress={() => navigation.navigate('Profile')}>
          <Ionicons name="person-circle" size={40} color="#2E7D32" />
        </TouchableOpacity>
      </View>

      {/* User code card */}
      <View style={styles.codeCard}>
        <Text style={styles.codeLabel}>Your User ID</Text>
        <Text style={styles.codeValue}>{user?.userCode ?? '------'}</Text>
        <Text style={styles.codeHint}>Enter this code at the disposal unit</Text>
      </View>

      {/* Stats grid */}
      <View style={styles.grid}>
        {cards.map((c, i) => (
          <View key={i} style={styles.statCard}>
            <Ionicons name={c.icon} size={24} color={c.color} />
            <Text style={styles.statValue}>{c.value}</Text>
            <Text style={styles.statLabel}>{c.label}</Text>
          </View>
        ))}
      </View>

      {/* Quick actions */}
      <Text style={styles.sectionTitle}>Quick Actions</Text>

      <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('Redeem')}>
        <View style={[styles.actionIcon, { backgroundColor: '#FFF8E1' }]}>
          <Ionicons name="send" size={22} color="#F57F17" />
        </View>
        <View style={styles.actionText}>
          <Text style={styles.actionTitle}>Redeem Airtime</Text>
          <Text style={styles.actionSub}>Convert your points to mobile airtime</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#ccc" />
      </TouchableOpacity>

      <TouchableOpacity style={styles.actionCard} onPress={() => navigation.navigate('History')}>
        <View style={[styles.actionIcon, { backgroundColor: '#E3F2FD' }]}>
          <Ionicons name="time" size={22} color="#1565C0" />
        </View>
        <View style={styles.actionText}>
          <Text style={styles.actionTitle}>Disposal History</Text>
          <Text style={styles.actionSub}>View your past recycling activity</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color="#ccc" />
      </TouchableOpacity>

      {/* Lifetime stats */}
      <View style={styles.lifetimeCard}>
        <Text style={styles.lifetimeTitle}>Lifetime Impact</Text>
        <View style={styles.lifetimeRow}>
          <View style={styles.lifetimeStat}>
            <Text style={styles.lifetimeValue}>{stats?.totalSessions ?? 0}</Text>
            <Text style={styles.lifetimeLabel}>Sessions</Text>
          </View>
          <View style={styles.lifetimeDivider} />
          <View style={styles.lifetimeStat}>
            <Text style={styles.lifetimeValue}>{stats?.totalItems ?? 0}</Text>
            <Text style={styles.lifetimeLabel}>Total Items</Text>
          </View>
          <View style={styles.lifetimeDivider} />
          <View style={styles.lifetimeStat}>
            <Text style={styles.lifetimeValue}>{balance?.lifetimePoints ?? 0}</Text>
            <Text style={styles.lifetimeLabel}>Points Earned</Text>
          </View>
        </View>
      </View>

      <View style={{ height: 30 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F0' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F0' },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 20, paddingTop: 16 },
  greeting: { fontSize: 14, color: '#888' },
  name: { fontSize: 24, fontWeight: '700', color: '#1B5E20' },
  profileBtn: { padding: 4 },
  codeCard: { backgroundColor: '#1B5E20', marginHorizontal: 20, borderRadius: 16, padding: 20, alignItems: 'center' },
  codeLabel: { color: '#A5D6A7', fontSize: 12, fontWeight: '600', textTransform: 'uppercase', letterSpacing: 1 },
  codeValue: { color: '#fff', fontSize: 36, fontWeight: '700', marginVertical: 8, letterSpacing: 4 },
  codeHint: { color: '#A5D6A7', fontSize: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 14, marginTop: 20 },
  statCard: { width: '46%', backgroundColor: '#fff', margin: '2%', borderRadius: 14, padding: 16, alignItems: 'center' },
  statValue: { fontSize: 22, fontWeight: '700', color: '#222', marginTop: 8 },
  statLabel: { fontSize: 12, color: '#888', marginTop: 4 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: '#333', paddingHorizontal: 20, marginTop: 24, marginBottom: 12 },
  actionCard: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 20, marginBottom: 10, borderRadius: 14, padding: 16 },
  actionIcon: { width: 44, height: 44, borderRadius: 12, justifyContent: 'center', alignItems: 'center', marginRight: 14 },
  actionText: { flex: 1 },
  actionTitle: { fontSize: 15, fontWeight: '600', color: '#222' },
  actionSub: { fontSize: 12, color: '#888', marginTop: 2 },
  lifetimeCard: { backgroundColor: '#fff', marginHorizontal: 20, marginTop: 20, borderRadius: 14, padding: 20 },
  lifetimeTitle: { fontSize: 16, fontWeight: '700', color: '#333', marginBottom: 16, textAlign: 'center' },
  lifetimeRow: { flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center' },
  lifetimeStat: { alignItems: 'center' },
  lifetimeValue: { fontSize: 22, fontWeight: '700', color: '#2E7D32' },
  lifetimeLabel: { fontSize: 11, color: '#888', marginTop: 4 },
  lifetimeDivider: { width: 1, height: 36, backgroundColor: '#eee' },
});
