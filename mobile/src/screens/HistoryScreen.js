import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, StyleSheet, ActivityIndicator, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { disposalAPI } from '../services/api';

function formatLabel(raw) {
  if (!raw) return 'Unknown Item';
  if (raw === 'no_detection') return 'No Item Detected';
  if (raw === 'error') return 'Classification Error';
  return raw.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export default function HistoryScreen() {
  const [events, setEvents] = useState([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);

  const load = async (p = 1, refresh = false) => {
    setError(null);
    try {
      const res = await disposalAPI.getHistory(p);
      const newEvents = res.data.events;
      setEvents(refresh ? newEvents : [...events, ...newEvents]);
      setTotalPages(res.data.pagination.totalPages);
      setPage(p);
    } catch (err) {
      setError('Could not load history. Pull down to retry.');
    }
    setLoading(false);
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  const onRefresh = () => { setRefreshing(true); load(1, true); };
  const onEndReached = () => { if (page < totalPages) load(page + 1); };

  const accepted = events.filter(e => e.isPlastic).length;
  const totalPoints = events.reduce((sum, e) => sum + (e.pointsAwarded ?? 0), 0);

  const renderEvent = ({ item }) => {
    const isAccepted = item.isPlastic;
    const date = new Date(item.createdAt);
    const timeStr = date.toLocaleDateString('en-UG', { day: 'numeric', month: 'short', year: 'numeric' })
      + ' at ' + date.toLocaleTimeString('en-UG', { hour: '2-digit', minute: '2-digit' });
    const label = formatLabel(item.classifiedAs);

    return (
      <View style={styles.card}>
        <View style={[styles.iconWrap, { backgroundColor: isAccepted ? '#E8F5E9' : '#FFEBEE' }]}>
          <Ionicons
            name={isAccepted ? 'checkmark-circle' : 'close-circle'}
            size={28}
            color={isAccepted ? '#2E7D32' : '#C62828'}
          />
        </View>
        <View style={styles.info}>
          <Text style={styles.classification}>{label}</Text>
          <Text style={styles.time}>{timeStr}</Text>
          <View style={styles.metaRow}>
            <Text style={[styles.statusTag, { backgroundColor: isAccepted ? '#E8F5E9' : '#FFEBEE', color: isAccepted ? '#2E7D32' : '#C62828' }]}>
              {isAccepted ? 'Accepted' : 'Rejected'}
            </Text>
            <Text style={styles.confidence}>{(item.confidence * 100).toFixed(0)}% confidence</Text>
          </View>
        </View>
        <View style={styles.points}>
          <Text style={[styles.pointsText, { color: isAccepted ? '#2E7D32' : '#ccc' }]}>
            {isAccepted ? `+${item.pointsAwarded ?? 50}` : '0'}
          </Text>
          <Text style={styles.ptsLabel}>pts</Text>
        </View>
      </View>
    );
  };

  const ListHeader = () => {
    if (events.length === 0) return null;
    return (
      <View style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{events.length}</Text>
          <Text style={styles.summaryLabel}>Scanned</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: '#2E7D32' }]}>{accepted}</Text>
          <Text style={styles.summaryLabel}>Accepted</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: '#C62828' }]}>{events.length - accepted}</Text>
          <Text style={styles.summaryLabel}>Rejected</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: '#F57F17' }]}>{totalPoints.toLocaleString()}</Text>
          <Text style={styles.summaryLabel}>Points</Text>
        </View>
      </View>
    );
  };

  const EmptyList = () => (
    <View style={styles.empty}>
      <Ionicons name="leaf-outline" size={64} color="#ccc" />
      <Text style={styles.emptyTitle}>No disposal history yet</Text>
      <Text style={styles.emptyText}>
        Visit an EcoLens kiosk, scan its QR code with the Scan tab, and insert a plastic bottle to start earning points.
      </Text>
    </View>
  );

  if (loading) return <View style={styles.center}><ActivityIndicator size="large" color="#2E7D32" /></View>;

  if (error) return (
    <View style={styles.center}>
      <Ionicons name="cloud-offline-outline" size={48} color="#ccc" />
      <Text style={styles.errorText}>{error}</Text>
    </View>
  );

  return (
    <View style={styles.container}>
      <FlatList
        data={events}
        keyExtractor={(item) => item.id}
        renderItem={renderEvent}
        ListHeaderComponent={ListHeader}
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
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F5F5F0', padding: 24 },
  summary: { flexDirection: 'row', backgroundColor: '#fff', marginHorizontal: 16, marginTop: 14, marginBottom: 4, borderRadius: 14, padding: 16, justifyContent: 'space-around' },
  summaryItem: { alignItems: 'center' },
  summaryValue: { fontSize: 20, fontWeight: '700', color: '#222' },
  summaryLabel: { fontSize: 11, color: '#888', marginTop: 2 },
  summaryDivider: { width: 1, backgroundColor: '#eee' },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', marginHorizontal: 16, marginTop: 8, borderRadius: 14, padding: 14 },
  iconWrap: { width: 48, height: 48, borderRadius: 14, justifyContent: 'center', alignItems: 'center', marginRight: 12 },
  info: { flex: 1 },
  classification: { fontSize: 15, fontWeight: '600', color: '#222' },
  time: { fontSize: 12, color: '#888', marginTop: 2 },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5, gap: 8 },
  statusTag: { fontSize: 11, fontWeight: '600', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 99 },
  confidence: { fontSize: 11, color: '#aaa' },
  points: { alignItems: 'center', minWidth: 44 },
  pointsText: { fontSize: 20, fontWeight: '700' },
  ptsLabel: { fontSize: 10, color: '#999' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#666', marginTop: 16 },
  emptyText: { fontSize: 14, color: '#999', textAlign: 'center', marginTop: 8, lineHeight: 22 },
  errorText: { fontSize: 14, color: '#888', textAlign: 'center', marginTop: 12, lineHeight: 20 },
});
