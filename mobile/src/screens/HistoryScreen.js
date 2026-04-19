import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { disposalAPI } from '../services/api';

export default function HistoryScreen() {
  const [events, setEvents] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = async (p = 1, refresh = false) => {
    try {
      const res = await disposalAPI.getHistory(p);
      const newEvents = res.data.events;
      setEvents(refresh ? newEvents : [...events, ...newEvents]);
      setTotalPages(res.data.pagination.totalPages);
      setPage(p);
    } catch {}
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  const onRefresh = () => { setRefreshing(true); load(1, true); };
  const onEndReached = () => { if (page < totalPages) load(page + 1); };

  const renderEvent = ({ item }) => {
    const accepted = item.isPlastic;
    const date = new Date(item.createdAt);
    const timeStr = date.toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })
      + ' at ' + date.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' });

    return (
      <View style={styles.card}>
        <View style={[styles.iconWrap, { backgroundColor: accepted ? '#E8F5E9' : '#FFEBEE' }]}>
          <Ionicons name={accepted ? 'checkmark-circle' : 'close-circle'} size={28} color={accepted ? '#2E7D32' : '#C62828'} />
        </View>
        <View style={styles.info}>
          <Text style={styles.classification}>{item.classifiedAs}</Text>
          <Text style={styles.time}>{timeStr}</Text>
          <Text style={styles.confidence}>Confidence: {(item.confidence * 100).toFixed(1)}%</Text>
        </View>
        <View style={styles.points}>
          <Text style={[styles.pointsText, { color: accepted ? '#2E7D32' : '#999' }]}>
            {accepted ? `+${item.pointsAwarded}` : '0'}
          </Text>
          <Text style={styles.ptsLabel}>pts</Text>
        </View>
      </View>
    );
  };

  const EmptyList = () => (
    <View style={styles.empty}>
      <Ionicons name="leaf-outline" size={64} color="#ccc" />
      <Text style={styles.emptyTitle}>No disposal history yet</Text>
      <Text style={styles.emptyText}>Visit a disposal unit to start recycling and earning points!</Text>
    </View>
  );

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#2E7D32" /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        ListEmptyComponent={EmptyList}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={['#2E7D32']} />}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.3}
        contentContainerStyle={events.length === 0 ? { flex: 1 } : { paddingBottom: 20 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F0' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F0' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 16, marginTop: 10, borderRadius: 14, padding: 14 },
  iconWrap: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  info: { flex: 1 },
  classification: { fontSize: 15, fontWeight: '600', color: '#222', textTransform: 'capitalize' },
  time: { fontSize: 12, color: '#888', marginTop: 2 },
  confidence: { fontSize: 11, color: '#aaa', marginTop: 2 },
  points: { alignItems: 'center', minWidth: 44 },
  pointsText: { fontSize: 20, fontWeight: '700' },
  ptsLabel: { fontSize: 10, color: '#999' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#666', marginTop: 16 },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 8, lineHeight: 20 },
});
